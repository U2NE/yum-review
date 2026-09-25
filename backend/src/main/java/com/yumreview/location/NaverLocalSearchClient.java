package com.yumreview.location;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Ephemeral server-side adapter for NAVER's Local Search API. Results are never cached or persisted. */
@Component
public class NaverLocalSearchClient {
    private static final String ENDPOINT = "https://openapi.naver.com/v1/search/local.json";
    private final JsonMapper json;
    private final String clientId;
    private final String clientSecret;
    private final HttpClient http;

    public NaverLocalSearchClient(JsonMapper json,
                                  @Value("${NAVER_LOCAL_CLIENT_ID:}") String clientId,
                                  @Value("${NAVER_LOCAL_CLIENT_SECRET:}") String clientSecret) {
        this.json = json;
        this.clientId = clientId == null ? "" : clientId.trim();
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    public LocationSearchResponse search(String rawQuery) {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.isBlank()) {
            throw new IllegalArgumentException("검색할 장소 이름이나 주소를 입력해 주세요.");
        }
        if (query.length() > 100) {
            throw new IllegalArgumentException("장소 검색어는 100자 이하여야 합니다.");
        }
        if (clientId.isBlank() || clientSecret.isBlank()) {
            return new LocationSearchResponse(false, false,
                    "장소 검색을 사용하려면 서버에 NAVER_LOCAL_CLIENT_ID와 NAVER_LOCAL_CLIENT_SECRET을 설정해 주세요.",
                    List.of());
        }

        String encodedQuery = URLEncoder.encode(query, StandardCharsets.UTF_8);
        URI uri = URI.create(ENDPOINT + "?query=" + encodedQuery + "&display=5&sort=random");
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(6))
                .header("X-Naver-Client-Id", clientId)
                .header("X-Naver-Client-Secret", clientSecret)
                .header("Accept", "application/json")
                .GET().build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new LocationSearchResponse(true, false,
                        "장소 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", List.of());
            }
            JsonNode root = json.readTree(response.body());
            List<PlaceSuggestion> items = new ArrayList<>();
            JsonNode sourceItems = root.path("items");
            if (sourceItems.isArray()) {
                for (JsonNode item : sourceItems) {
                    if (items.size() == 5) break;
                    items.add(toSuggestion(item));
                }
            }
            String message = items.isEmpty() ? "검색 결과가 없습니다." : null;
            return new LocationSearchResponse(true, true, message, List.copyOf(items));
        } catch (IOException exception) {
            return new LocationSearchResponse(true, false,
                    "장소 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", List.of());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new LocationSearchResponse(true, false,
                    "장소 검색이 중단됐습니다. 다시 시도해 주세요.", List.of());
        }
    }

    private PlaceSuggestion toSuggestion(JsonNode item) {
        String title = stripTitleMarkup(item.path("title").asText(""));
        Double latitude = coordinate(item.path("mapy").asText(null));
        Double longitude = coordinate(item.path("mapx").asText(null));
        if (latitude != null && (latitude < -90 || latitude > 90)) latitude = null;
        if (longitude != null && (longitude < -180 || longitude > 180)) longitude = null;
        if ((latitude == null) != (longitude == null)) {
            latitude = null;
            longitude = null;
        }
        return new PlaceSuggestion(title, item.path("category").asText(""),
                item.path("address").asText(""), item.path("roadAddress").asText(""),
                item.path("link").asText(""), latitude, longitude);
    }

    private static Double coordinate(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            // NAVER Local Search coordinates are WGS84 integers scaled by 10^7.
            return Long.parseLong(raw) / 10_000_000.0;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static String stripTitleMarkup(String title) {
        return title.replaceAll("(?i)</?b>", "").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                .replace("&#39;", "'");
    }

    public record LocationSearchResponse(boolean configured, boolean success,
                                         String message, List<PlaceSuggestion> results) { }

    public record PlaceSuggestion(String name, String category, String address, String roadAddress,
                                  String sourceUrl, Double latitude, Double longitude) { }
}
