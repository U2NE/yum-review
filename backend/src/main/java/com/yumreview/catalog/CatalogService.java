package com.yumreview.catalog;

import java.util.List;
import java.time.ZoneOffset;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

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

    public List<MenuCard> searchMenus(String query, String sort) {
        String normalized = query == null || query.isBlank() ? null : query.trim();
        var rows = switch (sort) {
            case "popular" -> reads.searchPopular(normalized);
            case "rating" -> reads.searchRating(normalized);
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sort must be popular or rating");
        };
        return rows.stream().map(CatalogService::toCard).toList();
    }

    public RestaurantDetail getRestaurant(Long id) {
        Restaurant restaurant = restaurants.findById(id)
                .orElseThrow(() -> new CatalogNotFoundException("식당을 찾을 수 없습니다."));
        List<MenuCard> cards = reads.findRestaurantMenus(id).stream().map(CatalogService::toCard).toList();
        return new RestaurantDetail(restaurant.getId(), restaurant.getName(), restaurant.getDescription(),
                restaurant.getAddress(), cards);
    }

    public MenuDetail getMenu(Long id) {
        var row = reads.findMenuAggregate(id)
                .orElseThrow(() -> new CatalogNotFoundException("메뉴를 찾을 수 없습니다."));
        Restaurant restaurant = restaurants.findById(row.getRestaurantId())
                .orElseThrow(() -> new CatalogNotFoundException("식당을 찾을 수 없습니다."));
        return new MenuDetail(row.getId(), row.getName(), row.getDescription(), row.getPriceKrw(),
                row.getRestaurantId(), row.getRestaurantName(), restaurant.getAddress(),
                row.getOverallAverage(), row.getTasteAverage(), row.getValueAverage(),
                row.getPortionAverage(), row.getReviewCount());
    }

    public List<PublicReview> getMenuReviews(Long id) {
        if (!menus.existsById(id)) throw new CatalogNotFoundException("메뉴를 찾을 수 없습니다.");
        return reads.findPublicReviews(id).stream()
                .map(row -> new PublicReview(row.getId(), "익명", row.getOverallScore(), row.getTasteScore(),
                        row.getValueScore(), row.getPortionScore(), row.getComment(),
                        row.getCreatedAt().atOffset(ZoneOffset.UTC)))
                .toList();
    }

    private static MenuCard toCard(PublicReviewReadRepository.MenuAggregate row) {
        return new MenuCard(row.getId(), row.getName(), row.getDescription(), row.getPriceKrw(),
                row.getRestaurantId(), row.getRestaurantName(), row.getOverallAverage(),
                row.getTasteAverage(), row.getValueAverage(), row.getPortionAverage(), row.getReviewCount());
    }
}
