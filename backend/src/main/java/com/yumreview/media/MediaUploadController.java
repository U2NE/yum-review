package com.yumreview.media;

import com.yumreview.auth.AppUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/api/media")
public class MediaUploadController {
    private final ImageStorageService storage;

    public MediaUploadController(ImageStorageService storage) {
        this.storage = storage;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ImageStorageService.UploadResult upload(MultipartHttpServletRequest request,
                                                   @AuthenticationPrincipal AppUser actor,
                                                   @RequestParam("kind") String kind,
                                                   @RequestParam("source") String source,
                                                   @RequestParam("rightsAttested") boolean rightsAttested,
                                                   @RequestParam("rightsBasis") String rightsBasis) {
        Map<String, java.util.List<MultipartFile>> files = request.getMultiFileMap();
        if (files.size() != 1 || !files.containsKey("file") || files.get("file").size() != 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "요청마다 사진 파일 하나만 첨부해 주세요.");
        }
        ImageStorageService.MediaKind mediaKind = parse(kind, ImageStorageService.MediaKind.class);
        ImageStorageService.Provenance provenance = parse(source, ImageStorageService.Provenance.class);
        return storage.upload(files.get("file").getFirst(), mediaKind, provenance,
                rightsAttested, rightsBasis, actor);
    }

    private static <T extends Enum<T>> T parse(String raw, Class<T> type) {
        try {
            return Enum.valueOf(type, raw.trim().toUpperCase(Locale.ROOT));
        } catch (RuntimeException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 유형과 출처를 확인해 주세요.");
        }
    }
}
