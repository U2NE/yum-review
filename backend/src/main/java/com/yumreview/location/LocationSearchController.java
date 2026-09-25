package com.yumreview.location;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/location")
public class LocationSearchController {
    private final NaverLocalSearchClient naver;

    public LocationSearchController(NaverLocalSearchClient naver) { this.naver = naver; }

    @GetMapping("/search")
    public ResponseEntity<NaverLocalSearchClient.LocationSearchResponse> search(
            @RequestParam("q") String query) {
        try {
            var result = naver.search(query);
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .header("Pragma", "no-cache").body(result);
        } catch (IllegalArgumentException invalid) {
            var result = new NaverLocalSearchClient.LocationSearchResponse(true, false,
                    invalid.getMessage(), java.util.List.of());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).cacheControl(CacheControl.noStore())
                    .header("Pragma", "no-cache").body(result);
        }
    }
}
