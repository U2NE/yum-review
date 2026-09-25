package com.yumreview.media;

import com.yumreview.auth.AppUser;
import com.yumreview.auth.RestaurantOwnerRepository;
import javax.imageio.ImageIO;
import javax.imageio.IIOImage;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileSystemException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;

@Service
public class ImageStorageService {
    private static final Logger log = LoggerFactory.getLogger(ImageStorageService.class);
    private static final long HARD_MAX_BYTES = 100_000_000L;
    private static final int MAX_EDGE = 5_000;
    private static final int MAX_DIMENSION = 12_000;

    private final MediaConfiguration.MediaProperties properties;
    private final StoredImageRepository images;
    private final RestaurantOwnerRepository owners;

    public ImageStorageService(MediaConfiguration.MediaProperties properties,
                               StoredImageRepository images,
                               RestaurantOwnerRepository owners) {
        this.properties = properties;
        this.images = images;
        this.owners = owners;
    }

    @Transactional
    public UploadResult upload(MultipartFile file, MediaKind kind, Provenance provenance,
                               boolean rightsAttested, String rightsBasis, AppUser actor) {
        if (actor == null || actor.getId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
        }
        if (kind == null || provenance == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 유형과 출처를 확인해 주세요.");
        }
        validateAttestation(rightsAttested, rightsBasis);
        validateProvenance(kind, provenance, actor);
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 파일을 선택해 주세요.");
        }
        long reportedBytes = file.getSize();
        if (reportedBytes >= HARD_MAX_BYTES || reportedBytes > properties.getMaxUploadBytes()) {
            throw tooLarge();
        }
        Path stage = null;
        Path optimized = null;
        Path storedPath = null;
        boolean moved = false;
        long inputBytes = 0;
        try {
            Files.createDirectories(properties.getDirectoryPath());
            Files.createDirectories(properties.getTemporaryDirectory());
            stage = Files.createTempFile(properties.getTemporaryDirectory(), "yum-stage-", ".part");
            inputBytes = streamToStage(file, stage);
            verifySupportedSignature(stage);

            BufferedImage decoded = decodeBounded(stage);
            optimized = Files.createTempFile(properties.getTemporaryDirectory(), "yum-output-", ".part");
            encodeOptimized(decoded, optimized);
            decoded.flush();

            String mediaId = UUID.randomUUID().toString();
            String storageKey = kind.storagePrefix() + "-" + mediaId + ".webp";
            storedPath = resolveStorageKey(storageKey);
            moveIntoPlace(optimized, storedPath);
            moved = true;

            Path rollbackPath = storedPath;
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        deleteIncomplete(rollbackPath);
                    }
                }
            });

            long storedBytes = Files.size(storedPath);
            StoredImage record = StoredImage.uploaded(mediaId, storageKey, actor.getId(),
                    inputBytes, storedBytes, sha256(storedPath), provenance.name(),
                    rightsBasis.trim(), OffsetDateTime.now(ZoneOffset.UTC));
            images.saveAndFlush(record);
            return new UploadResult(mediaId, kind, "image/webp", inputBytes, storedBytes, StoredImage.ACTIVE);
        } catch (ResponseStatusException exception) {
            throw exception;
        } catch (IOException exception) {
            if (storedPath != null && moved) deleteIncomplete(storedPath);
            if (isDiskFull(exception)) {
                throw new ResponseStatusException(HttpStatus.INSUFFICIENT_STORAGE, "사진을 저장할 공간이 부족합니다.");
            }
            log.warn("Image upload failed during local processing; inputBytes={}", inputBytes);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 파일을 읽거나 처리하지 못했습니다.");
        } finally {
            if (stage != null) deleteIncomplete(stage);
            if (optimized != null) deleteIncomplete(optimized);
        }
    }

    Path resolveStorageKey(String storageKey) {
        if (storageKey == null || !storageKey.matches("(?:menu|review)-[0-9a-fA-F-]{36}\\.webp")) {
            throw new IllegalStateException("Stored image key is invalid");
        }
        Path root = properties.getDirectoryPath();
        Path resolved = root.resolve(storageKey).normalize();
        if (!root.equals(resolved.getParent()) || Files.isSymbolicLink(resolved)) {
            throw new IllegalStateException("Stored image path is invalid");
        }
        return resolved;
    }

    void deleteStoredBytes(String storageKey) throws IOException {
        Path path = resolveStorageKey(storageKey);
        Files.deleteIfExists(path);
    }

    Path activeImagePath(StoredImage image) {
        return resolveStorageKey(image.getStorageKey());
    }

    private long streamToStage(MultipartFile file, Path stage) throws IOException {
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (InputStream input = new BufferedInputStream(file.getInputStream());
             var output = Files.newOutputStream(stage, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total >= HARD_MAX_BYTES || total > properties.getMaxUploadBytes()) throw tooLarge();
                output.write(buffer, 0, read);
            }
        }
        if (total <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 파일이 비어 있습니다.");
        return total;
    }

    private static void verifySupportedSignature(Path path) throws IOException {
        byte[] header = new byte[12];
        int count;
        try (InputStream input = Files.newInputStream(path)) {
            count = input.readNBytes(header, 0, header.length);
        }
        boolean jpeg = count >= 3 && unsigned(header[0]) == 0xff && unsigned(header[1]) == 0xd8 && unsigned(header[2]) == 0xff;
        boolean png = count >= 8 && unsigned(header[0]) == 0x89 && header[1] == 'P' && header[2] == 'N'
                && header[3] == 'G' && unsigned(header[4]) == 0x0d && unsigned(header[5]) == 0x0a
                && unsigned(header[6]) == 0x1a && unsigned(header[7]) == 0x0a;
        boolean webp = count >= 12 && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F'
                && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P';
        if (!jpeg && !png && !webp) throw unsupportedImage();
    }

    private BufferedImage decodeBounded(Path path) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(path.toFile())) {
            if (input == null) throw unsupportedImage();
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw unsupportedImage();
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                long pixels = (long) width * height;
                if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION
                        || pixels > properties.getMaxDecodedPixels()) {
                    throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "사진의 해상도가 너무 큽니다.");
                }
                BufferedImage decoded;
                try {
                    decoded = reader.read(0);
                } catch (RuntimeException | IOException failure) {
                    throw unsupportedImage();
                }
                if (decoded == null) throw unsupportedImage();
                return decoded;
            } finally {
                reader.dispose();
            }
        }
    }

    private void encodeOptimized(BufferedImage source, Path output) throws IOException {
        BufferedImage normalized = normalizeForWebp(source);
        int sourceWidth = normalized.getWidth();
        int sourceHeight = normalized.getHeight();
        double initialScale = Math.min(1d, (double) MAX_EDGE / Math.max(sourceWidth, sourceHeight));
        BufferedImage candidate = initialScale < 1d ? resize(normalized, initialScale) : normalized;
        float[] qualities = {0.88f, 0.82f, 0.76f, 0.70f, 0.64f, 0.64f, 0.64f, 0.64f};
        try {
            for (int attempt = 0; attempt < qualities.length; attempt++) {
                writeWebp(candidate, output, qualities[attempt]);
                if (Files.size(output) <= properties.getOptimizeTargetBytes()) return;
                if (attempt + 1 < qualities.length) {
                    BufferedImage smaller = resize(candidate, 0.88d);
                    candidate.flush();
                    candidate = smaller;
                }
            }
            // A valid, decodable image remains acceptable if encoding cannot reach the optimization target.
        } finally {
            candidate.flush();
            if (candidate != normalized) normalized.flush();
        }
    }

    private static BufferedImage normalizeForWebp(BufferedImage source) {
        int type = source.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage normalized = new BufferedImage(source.getWidth(), source.getHeight(), type);
        Graphics2D graphics = normalized.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            graphics.drawImage(source, 0, 0, null);
        } finally {
            graphics.dispose();
        }
        return normalized;
    }

    private static BufferedImage resize(BufferedImage source, double scale) {
        int width = Math.max(1, (int) Math.floor(source.getWidth() * scale));
        int height = Math.max(1, (int) Math.floor(source.getHeight() * scale));
        int type = source.getColorModel().hasAlpha() ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB;
        BufferedImage resized = new BufferedImage(width, height, type);
        Graphics2D graphics = resized.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.drawImage(source, 0, 0, width, height, null);
        } finally {
            graphics.dispose();
        }
        return resized;
    }

    private static void writeWebp(BufferedImage image, Path output, float quality) throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByMIMEType("image/webp");
        if (!writers.hasNext()) throw new IOException("WebP encoder is unavailable");
        ImageWriter writer = writers.next();
        try (ImageOutputStream imageOutput = ImageIO.createImageOutputStream(
                Files.newOutputStream(output, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING))) {
            if (imageOutput == null) throw new IOException("Image output could not be opened");
            writer.setOutput(imageOutput);
            ImageWriteParam parameters = writer.getDefaultWriteParam();
            if (parameters.canWriteCompressed()) {
                parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                String[] compressionTypes = parameters.getCompressionTypes();
                if (compressionTypes != null && compressionTypes.length > 0) {
                    parameters.setCompressionType(compressionTypes[0]);
                }
                parameters.setCompressionQuality(quality);
            }
            writer.write(null, new IIOImage(image, null, null), parameters);
            imageOutput.flush();
        } finally {
            writer.dispose();
        }
    }

    private void validateProvenance(MediaKind kind, Provenance provenance, AppUser actor) {
        boolean valid = switch (provenance) {
            case OWNER_UPLOAD -> kind == MediaKind.MENU && !owners.findByIdUserId(actor.getId()).isEmpty();
            case ADMIN_UPLOAD -> kind == MediaKind.MENU && actor.isServerAdmin();
            case USER_UPLOAD -> kind == MediaKind.REVIEW;
            case LICENSED -> true;
        };
        if (!valid) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "이 유형의 사진을 등록할 권한이 없습니다.");
    }

    private static void validateAttestation(boolean attested, String rightsBasis) {
        if (!attested || rightsBasis == null || rightsBasis.isBlank() || rightsBasis.trim().length() > 500) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 사용 권리와 출처를 확인해 주세요.");
        }
    }

    private static String sha256(Path path) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(path)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static void moveIntoPlace(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(source, target);
        }
    }

    private static boolean isDiskFull(IOException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            String detail = cause.getMessage();
            if (cause instanceof FileSystemException fileSystemException && fileSystemException.getReason() != null) {
                detail = fileSystemException.getReason() + " " + detail;
            }
            if (detail == null) continue;
            String normalized = detail.toLowerCase(Locale.ROOT);
            if (normalized.contains("no space") || normalized.contains("no space left")
                    || normalized.contains("not enough space") || normalized.contains("insufficient space")
                    || normalized.contains("disk full") || normalized.contains("disk is full")
                    || normalized.contains("quota") || normalized.contains("저장 공간")) return true;
        }
        return false;
    }

    static void deleteIncomplete(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException exception) {
            log.warn("Temporary image cleanup failed");
        }
    }

    private static int unsigned(byte value) { return value & 0xff; }

    private static ResponseStatusException tooLarge() {
        return new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "100MB 미만의 사진만 등록할 수 있습니다.");
    }

    private static ResponseStatusException unsupportedImage() {
        return new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "JPEG, PNG, WebP 사진만 등록할 수 있습니다.");
    }

    public enum MediaKind {
        MENU("menu"), REVIEW("review");
        private final String storagePrefix;
        MediaKind(String storagePrefix) { this.storagePrefix = storagePrefix; }
        String storagePrefix() { return storagePrefix; }
    }

    public enum Provenance { OWNER_UPLOAD, ADMIN_UPLOAD, USER_UPLOAD, LICENSED }

    public record UploadResult(String mediaId, MediaKind kind, String contentType,
                               long originalBytes, long storedBytes, String lifecycleStatus) { }
}
