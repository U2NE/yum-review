package com.yumreview.media;

import com.yumreview.auth.AppUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Service
public class ImageLifecycleService {
    private static final Logger log = LoggerFactory.getLogger(ImageLifecycleService.class);

    private final StoredImageRepository images;
    private final ImageStorageService storage;
    private final MediaConfiguration.MediaProperties properties;
    private final TransactionTemplate cleanupTransaction;

    public ImageLifecycleService(StoredImageRepository images, ImageStorageService storage,
                                 MediaConfiguration.MediaProperties properties,
                                 PlatformTransactionManager transactionManager) {
        this.images = images;
        this.storage = storage;
        this.properties = properties;
        this.cleanupTransaction = new TransactionTemplate(transactionManager);
        this.cleanupTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Call from the same domain transaction that inserts menu.photo_media_id or review_photo.
     * The row lock serializes claims across both association tables; callers must keep their
     * transaction open until the association write is complete.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public StoredImage requireAttachableBy(String mediaId, AppUser actor,
                                           ImageStorageService.MediaKind expectedKind) {
        if (actor == null || actor.getId() == null || expectedKind == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "사진을 연결할 권한이 없습니다.");
        }
        StoredImage image = images.findLockedByMediaId(mediaId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "사진을 찾을 수 없습니다."));
        if (!StoredImage.ACTIVE.equals(image.getLifecycleStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "더 이상 사용할 수 없는 사진입니다.");
        }
        if (!hasKind(image, expectedKind)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 유형이 연결 대상과 일치하지 않습니다.");
        }
        // Review photos are private to their uploader, even for a server administrator.
        if (expectedKind == ImageStorageService.MediaKind.REVIEW
                && !Objects.equals(image.getUploadedByUserId(), actor.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "다른 사용자의 사진은 리뷰에 연결할 수 없습니다.");
        }
        if (expectedKind == ImageStorageService.MediaKind.MENU
                && !actor.isServerAdmin()
                && !Objects.equals(image.getUploadedByUserId(), actor.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "다른 사용자의 사진은 메뉴에 연결할 수 없습니다.");
        }
        if (images.existsAssociationByMediaId(mediaId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 다른 메뉴나 리뷰에 연결된 사진입니다.");
        }
        return image;
    }

    /**
     * Call in the domain transaction after removing the menu/review association. This revokes
     * public serving immediately on commit and deletes bytes/metadata only after that commit.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void scheduleDeletion(String mediaId) {
        StoredImage image = images.findLockedByMediaId(mediaId).orElse(null);
        if (image == null) return;
        image.markDeletePending();
        registerAfterCommitCleanup(mediaId);
    }

    @Transactional
    int markAgedUnattachedImagesForDeletion() {
        OffsetDateTime before = OffsetDateTime.now(ZoneOffset.UTC)
                .minus(duration(properties.getUnattachedImageGrace()));
        List<StoredImage> candidates = images.findByLifecycleStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
                StoredImage.ACTIVE, before, PageRequest.of(0, 200));
        int marked = 0;
        for (StoredImage candidate : candidates) {
            StoredImage image = images.findLockedByMediaId(candidate.getMediaId()).orElse(null);
            if (image == null || !StoredImage.ACTIVE.equals(image.getLifecycleStatus())
                    || images.existsAssociationByMediaId(image.getMediaId())) continue;
            image.markDeletePending();
            registerAfterCommitCleanup(image.getMediaId());
            marked++;
        }
        return marked;
    }

    int retryPendingDeletes() {
        List<StoredImage> pending = images.findByLifecycleStatusOrderByCreatedAtAsc(
                StoredImage.DELETE_PENDING, PageRequest.of(0, 200));
        int deleted = 0;
        for (StoredImage image : pending) if (cleanupOne(image.getMediaId())) deleted++;
        return deleted;
    }

    int cleanStaleTemporaryFiles() {
        var directory = properties.getTemporaryDirectory();
        OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC)
                .minus(duration(properties.getStagingFileGrace()));
        int removed = 0;
        try (var paths = java.nio.file.Files.list(directory)) {
            for (var path : paths.toList()) {
                String name = path.getFileName().toString();
                if (!(name.startsWith("yum-stage-") || name.startsWith("yum-output-"))
                        || !name.endsWith(".part") || java.nio.file.Files.isSymbolicLink(path)
                        || !java.nio.file.Files.isRegularFile(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) continue;
                OffsetDateTime modified = java.nio.file.Files.getLastModifiedTime(path,
                        java.nio.file.LinkOption.NOFOLLOW_LINKS).toInstant().atOffset(ZoneOffset.UTC);
                if (modified.isBefore(cutoff) && java.nio.file.Files.deleteIfExists(path)) removed++;
            }
        } catch (IOException exception) {
            log.warn("Stale image staging cleanup could not complete");
        }
        return removed;
    }

    int cleanAgedOrphanFiles() {
        OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC)
                .minus(duration(properties.getUnattachedImageGrace()));
        int removed = 0;
        try (var paths = java.nio.file.Files.list(properties.getDirectoryPath())) {
            for (var path : paths.toList()) {
                String storageKey = path.getFileName().toString();
                if (!storageKey.matches("(?:menu|review)-[0-9a-fA-F-]{36}\\.webp")
                        || java.nio.file.Files.isSymbolicLink(path)
                        || !java.nio.file.Files.isRegularFile(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) continue;
                OffsetDateTime modified = java.nio.file.Files.getLastModifiedTime(path,
                        java.nio.file.LinkOption.NOFOLLOW_LINKS).toInstant().atOffset(ZoneOffset.UTC);
                if (modified.isBefore(cutoff) && !images.existsByStorageKey(storageKey)
                        && java.nio.file.Files.deleteIfExists(path)) removed++;
            }
        } catch (IOException | RuntimeException exception) {
            log.warn("Orphan image reconciliation could not complete");
        }
        return removed;
    }

    private void registerAfterCommitCleanup(String mediaId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new IllegalStateException("Image lifecycle changes require an active transaction");
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                if (!cleanupOne(mediaId)) log.warn("Image cleanup deferred; mediaId={} status=retry", mediaId);
            }
        });
    }

    private boolean cleanupOne(String mediaId) {
        try {
            Boolean removed = cleanupTransaction.execute(status -> {
                StoredImage image = images.findLockedByMediaId(mediaId).orElse(null);
                if (image == null) return true;
                if (!StoredImage.DELETE_PENDING.equals(image.getLifecycleStatus())) return false;
                if (images.existsAssociationByMediaId(mediaId)) return false;
                try {
                    storage.deleteStoredBytes(image.getStorageKey());
                    images.delete(image);
                    images.flush();
                    return true;
                } catch (IOException failure) {
                    status.setRollbackOnly();
                    return false;
                }
            });
            return Boolean.TRUE.equals(removed);
        } catch (RuntimeException failure) {
            log.warn("Image cleanup transaction failed; mediaId={} status=retry", mediaId);
            return false;
        }
    }

    private static boolean hasKind(StoredImage image, ImageStorageService.MediaKind kind) {
        return image.getStorageKey().startsWith(kind.name().toLowerCase(Locale.ROOT) + "-");
    }

    private static Duration duration(String configured) {
        return DurationStyle.detectAndParse(configured);
    }
}
