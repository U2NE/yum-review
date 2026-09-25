package com.yumreview.media;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;

@Controller
public class ImageController {
    private static final Logger log = LoggerFactory.getLogger(ImageController.class);

    private final StoredImageRepository images;
    private final ImageStorageService storage;

    public ImageController(StoredImageRepository images, ImageStorageService storage) {
        this.images = images;
        this.storage = storage;
    }

    @GetMapping("/api/images/{mediaId}")
    public ResponseEntity<Resource> image(@PathVariable String mediaId) {
        if (mediaId == null || !mediaId.matches("[0-9a-fA-F-]{36}")) throw notFound();
        StoredImage image = images.findByMediaIdAndLifecycleStatus(mediaId, StoredImage.ACTIVE)
                .orElseThrow(ImageController::notFound);
        Path path = storage.activeImagePath(image);
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            log.warn("Active media object is missing; mediaId={}", mediaId);
            throw notFound();
        }
        try {
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(image.getContentType()))
                    .contentLength(Files.size(path))
                    .cacheControl(CacheControl.noStore())
                    .header("X-Content-Type-Options", "nosniff")
                    .body(new FileSystemResource(path));
        } catch (IOException | IllegalArgumentException failure) {
            log.warn("Active media could not be opened; mediaId={}", mediaId);
            throw notFound();
        }
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "사진을 찾을 수 없습니다.");
    }
}
