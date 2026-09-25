package com.yumreview.auth;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AdminAuthorizationService {
    private final RestaurantOwnerRepository owners;

    public AdminAuthorizationService(RestaurantOwnerRepository owners) { this.owners = owners; }

    public void requireServerAdmin(AppUser actor) {
        if (actor == null || !actor.isServerAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "서버 관리자 권한이 필요합니다.");
        }
    }

    public boolean ownsRestaurant(AppUser actor, Long restaurantId) {
        return actor != null && owners.existsByIdUserIdAndIdRestaurantId(actor.getId(), restaurantId);
    }

    public void requireRestaurantOwner(AppUser actor, Long restaurantId) {
        if (actor == null || (!actor.isServerAdmin() && !ownsRestaurant(actor, restaurantId))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "이 식당을 관리할 권한이 없습니다.");
        }
    }
}
