package com.yumreview.catalog;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;

import static com.yumreview.catalog.CatalogDtos.*;

@Service
@Transactional(readOnly = true)
public class CatalogService {
    public static class CatalogNotFoundException extends RuntimeException {
        public CatalogNotFoundException(String message) { super(message); }
    }

    private final RestaurantRepository restaurants;
    private final MenuRepository menus;
    private final PublicReviewReadRepository reads;

    public CatalogService(RestaurantRepository restaurants, MenuRepository menus,
                          PublicReviewReadRepository reads) {
        this.restaurants = restaurants;
        this.menus = menus;
        this.reads = reads;
    }

    public MenuSearchResponse searchMenus(String query, String category, String region,
                                          Double latitude, Double longitude, Integer radiusMeters,
                                          String requestedSort) {
        String normalizedQuery = normalizeText(query, 120, "검색어");
        String normalizedRegion = normalizeText(region, 120, "지역");
        String normalizedCategory = normalizeCategory(category);
        String sort = normalizeSort(requestedSort);
        validateLocation(latitude, longitude, radiusMeters);

        List<MenuCard> cards = reads.search(normalizedQuery, normalizedCategory, normalizedRegion,
                        latitude, longitude, radiusMeters, sort)
                .stream().map(CatalogService::toCard).toList();
        boolean radiusApplied = radiusMeters != null;
        long unlocatedCount = radiusApplied
                ? reads.countUnlocated(normalizedQuery, normalizedCategory, normalizedRegion) : 0;
        String notice = radiusApplied && unlocatedCount > 0
                ? unlocatedCount + "개 메뉴는 가게 위치가 확인되지 않아 반경 결과에서 제외했습니다."
                : null;
        return new MenuSearchResponse(cards, sort, radiusApplied, unlocatedCount, notice);
    }

    public RestaurantDetail getRestaurant(Long id) {
        Restaurant restaurant = restaurants.findById(id)
                .orElseThrow(() -> new CatalogNotFoundException("식당을 찾을 수 없습니다."));
        List<MenuCard> cards = reads.findRestaurantMenus(id, null, null).stream()
                .map(CatalogService::toCard).toList();
        return new RestaurantDetail(restaurant.getId(), restaurant.getName(), restaurant.getDescription(),
                restaurant.getAddress(), restaurant.getRegion(), cards);
    }

    public MenuDetail getMenu(Long id) {
        var row = reads.findMenuAggregate(id, null, null)
                .orElseThrow(() -> new CatalogNotFoundException("메뉴를 찾을 수 없습니다."));
        return new MenuDetail(row.getId(), row.getName(), row.getDescription(), row.getPriceKrw(),
                row.getRestaurantId(), row.getRestaurantName(), row.getRestaurantAddress(), row.getRegion(),
                row.getCuisineCategory(), imageUrl(row.getPhotoMediaId()), row.getOverallAverage(),
                row.getTasteAverage(), row.getValueAverage(), row.getPortionAverage(), row.getReviewCount());
    }

    public List<PublicReview> getMenuReviews(Long id) {
        if (!menus.existsByIdAndActiveTrue(id)) throw new CatalogNotFoundException("메뉴를 찾을 수 없습니다.");
        return reads.findPublicReviews(id).stream()
                .map(row -> new PublicReview(row.getId(), "익명", row.getOverallScore(), row.getTasteScore(),
                        row.getValueScore(), row.getPortionScore(), row.getComment(),
                        row.getCreatedAt().atOffset(ZoneOffset.UTC), photoIds(row.getPhotoMediaIdsCsv())))
                .toList();
    }

    static MenuCard toCard(PublicReviewReadRepository.MenuAggregate row) {
        return new MenuCard(row.getId(), row.getName(), row.getDescription(), row.getPriceKrw(),
                row.getRestaurantId(), row.getRestaurantName(), row.getRestaurantAddress(), row.getRegion(),
                row.getCuisineCategory(), imageUrl(row.getPhotoMediaId()), row.getDistanceMeters(),
                row.getOverallAverage(), row.getTasteAverage(), row.getValueAverage(),
                row.getPortionAverage(), row.getReviewCount());
    }

    static String imageUrl(String mediaId) {
        return mediaId == null || mediaId.isBlank() ? null : "/api/images/" + mediaId;
    }

    private static List<String> photoIds(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return java.util.Arrays.stream(csv.split(","))
                .filter(value -> !value.isBlank()).toList();
    }

    private static String normalizeText(String value, int maxLength, String field) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        if (normalized.length() > maxLength) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + "은(는) " + maxLength + "자 이하여야 합니다.");
        }
        return normalized;
    }

    private static String normalizeCategory(String category) {
        if (category == null || category.isBlank() || "ALL".equalsIgnoreCase(category.trim())) return null;
        String normalized = category.trim().toUpperCase(Locale.ROOT);
        try {
            return Menu.CuisineCategory.valueOf(normalized).name();
        } catch (IllegalArgumentException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "음식 종류를 확인해 주세요.");
        }
    }

    private static String normalizeSort(String requested) {
        if (requested == null || requested.isBlank()) return "overall";
        return switch (requested.trim().toLowerCase(Locale.ROOT)) {
            case "overall", "rating" -> "overall";
            case "taste" -> "taste";
            case "value" -> "value";
            case "portion" -> "portion";
            case "reviewcount", "review_count", "popular" -> "reviewCount";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "sort은 overall, taste, value, portion, reviewCount 중 하나여야 합니다.");
        };
    }

    private static void validateLocation(Double latitude, Double longitude, Integer radiusMeters) {
        boolean any = latitude != null || longitude != null || radiusMeters != null;
        boolean all = latitude != null && longitude != null && radiusMeters != null;
        if (any && !all) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "반경 검색은 위도, 경도, 반경을 함께 지정해 주세요.");
        }
        if (!any) return;
        if (!Double.isFinite(latitude) || latitude < -90 || latitude > 90
                || !Double.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "위치 좌표를 확인해 주세요.");
        }
        if (!List.of(300, 500, 1000).contains(radiusMeters)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "반경은 300, 500, 1000미터 중 하나여야 합니다.");
        }
    }
}
