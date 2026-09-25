package com.yumreview.media;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

public interface StoredImageRepository extends JpaRepository<StoredImage, String> {
    Optional<StoredImage> findByMediaIdAndLifecycleStatus(String mediaId, String lifecycleStatus);

    boolean existsByStorageKey(String storageKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select image from StoredImage image where image.mediaId = :mediaId")
    Optional<StoredImage> findLockedByMediaId(@Param("mediaId") String mediaId);

    List<StoredImage> findByLifecycleStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
            String lifecycleStatus, OffsetDateTime before, Pageable pageable);

    List<StoredImage> findByLifecycleStatusOrderByCreatedAtAsc(String lifecycleStatus, Pageable pageable);

    @Query(value = "select (exists (select 1 from menu where photo_media_id = :mediaId) "
            + "or exists (select 1 from review_photo where media_id = :mediaId))", nativeQuery = true)
    boolean existsAssociationByMediaId(@Param("mediaId") String mediaId);
}
