package com.yumreview.catalog;

import com.yumreview.auth.AdminAuthorizationService;
import com.yumreview.auth.AppUser;
import com.yumreview.media.ImageLifecycleService;
import com.yumreview.media.ImageStorageService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static com.yumreview.catalog.CatalogDtos.*;

@Service
public class CatalogAdminService {
    private final RestaurantRepository restaurants;
    private final MenuRepository menus;
    private final PublicReviewReadRepository reads;
    private final AdminAuthorizationService authorization;
    private final ImageLifecycleService images;

    public CatalogAdminService(RestaurantRepository restaurants, MenuRepository menus,
                               PublicReviewReadRepository reads,
                               AdminAuthorizationService authorization,
                               ImageLifecycleService images) {
        this.restaurants = restaurants;
        this.menus = menus;
        this.reads = reads;
        this.authorization = authorization;
        this.images = images;
    }

    @Transactional(readOnly = true)
    public List<MenuManagementItem> listMenus(AppUser actor, Long restaurantId) {
        authorization.requireRestaurantOwner(actor, restaurantId);
        requireRestaurant(restaurantId);
        return reads.findManageRestaurantMenus(restaurantId, null, null).stream()
                .map(CatalogAdminService::toManagementItem).toList();
    }

    @Transactional
    public MenuManagementItem createMenu(AppUser actor, Long restaurantId, MenuWriteRequest request) {
        authorization.requireRestaurantOwner(actor, restaurantId);
        Restaurant restaurant = requireRestaurant(restaurantId);
        Menu menu = new Menu(restaurant, clean(request.name()), clean(request.description()),
                request.priceKrw(), request.cuisineCategory());
        if (request.active() != null) {
            menu.apply(clean(request.name()), clean(request.description()), request.priceKrw(),
                    request.cuisineCategory(), request.active());
        }

        String mediaId = clean(request.photoMediaId());
        if (mediaId != null) {
            images.requireAttachableBy(mediaId, actor, ImageStorageService.MediaKind.MENU);
            menu.setPhotoMediaId(mediaId);
        }
        menus.saveAndFlush(menu);
        return findManagementItem(menu.getId());
    }

    @Transactional
    public MenuManagementItem updateMenu(AppUser actor, Long menuId, MenuWriteRequest request) {
        Menu menu = findMenu(menuId);
        authorization.requireRestaurantOwner(actor, menu.getRestaurant().getId());

        String previousMediaId = menu.getPhotoMediaId();
        String nextMediaId = clean(request.photoMediaId());
        boolean photoChanged = !java.util.Objects.equals(previousMediaId, nextMediaId);
        if (photoChanged && nextMediaId != null) {
            // Claim the upload inside this transaction immediately before changing the association.
            images.requireAttachableBy(nextMediaId, actor, ImageStorageService.MediaKind.MENU);
        }

        menu.apply(clean(request.name()), clean(request.description()), request.priceKrw(),
                request.cuisineCategory(), request.active());
        if (photoChanged) menu.setPhotoMediaId(nextMediaId);
        menus.saveAndFlush(menu);
        if (photoChanged && previousMediaId != null) images.scheduleDeletion(previousMediaId);
        return findManagementItem(menu.getId());
    }

    @Transactional
    public OperationResult deactivateMenu(AppUser actor, Long menuId) {
        Menu menu = findMenu(menuId);
        authorization.requireRestaurantOwner(actor, menu.getRestaurant().getId());
        String previousMediaId = menu.getPhotoMediaId();
        menu.apply(menu.getName(), menu.getDescription(), menu.getPriceKrw(),
                menu.getCuisineCategory(), false);
        if (previousMediaId != null) menu.setPhotoMediaId(null);
        menus.saveAndFlush(menu);
        if (previousMediaId != null) images.scheduleDeletion(previousMediaId);
        return new OperationResult("메뉴를 목록에서 내렸습니다. 기존 리뷰와 평점은 보존됩니다.");
    }

    private Restaurant requireRestaurant(Long restaurantId) {
        return restaurants.findById(restaurantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "식당을 찾을 수 없습니다."));
    }

    private Menu findMenu(Long menuId) {
        return menus.findById(menuId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "메뉴를 찾을 수 없습니다."));
    }

    private MenuManagementItem findManagementItem(Long menuId) {
        PublicReviewReadRepository.MenuAggregate row = reads.findManageRestaurantMenus(
                        menus.findById(menuId).orElseThrow().getRestaurant().getId(), null, null).stream()
                .filter(candidate -> candidate.getId().equals(menuId)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "저장한 메뉴 정보를 다시 읽지 못했습니다."));
        return toManagementItem(row);
    }

    private static MenuManagementItem toManagementItem(PublicReviewReadRepository.MenuAggregate row) {
        return new MenuManagementItem(row.getId(), row.getRestaurantId(), row.getName(), row.getDescription(),
                row.getPriceKrw(), row.getCuisineCategory(), CatalogService.imageUrl(row.getPhotoMediaId(), row.getPhotoUrl()),
                Boolean.TRUE.equals(row.getActive()), row.getOverallAverage(), row.getTasteAverage(),
                row.getValueAverage(), row.getPortionAverage(), row.getReviewCount());
    }

    private static String clean(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
