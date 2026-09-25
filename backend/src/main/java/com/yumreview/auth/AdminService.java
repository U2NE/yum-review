package com.yumreview.auth;

import com.yumreview.catalog.RestaurantRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class AdminService {
    private final AppUserRepository users;
    private final RestaurantOwnerRepository owners;
    private final RestaurantRepository restaurants;
    private final AdminAuthorizationService authorization;

    public AdminService(AppUserRepository users, RestaurantOwnerRepository owners,
                        RestaurantRepository restaurants, AdminAuthorizationService authorization) {
        this.users = users;
        this.owners = owners;
        this.restaurants = restaurants;
        this.authorization = authorization;
    }

    @Transactional(readOnly = true)
    public List<AdminDtos.OwnerAssignment> listOwners(AppUser actor) {
        authorization.requireServerAdmin(actor);
        return owners.findAll().stream()
                .map(owner -> users.findById(owner.getUserId()).map(user -> new AdminDtos.OwnerAssignment(
                        user.getId(), user.getEmail(), owner.getRestaurantId())).orElse(null))
                .filter(java.util.Objects::nonNull)
                .sorted(java.util.Comparator.comparing(AdminDtos.OwnerAssignment::restaurantId)
                        .thenComparing(AdminDtos.OwnerAssignment::userId)).toList();
    }

    @Transactional(readOnly = true)
    public List<AdminDtos.UserOption> searchUsers(AppUser actor, String rawQuery) {
        authorization.requireServerAdmin(actor);
        String query = rawQuery == null ? "" : rawQuery.trim().toLowerCase(java.util.Locale.ROOT);
        if (query.length() < 3 || query.length() > 320) return List.of();
        return users.findTop10ByEmailNormalizedContainingOrderByEmailNormalizedAsc(query).stream()
                .map(user -> new AdminDtos.UserOption(user.getId(), user.getEmail())).toList();
    }

    @Transactional
    public AdminDtos.OwnerAssignment assignOwner(AppUser actor, Long restaurantId, Long userId) {
        authorization.requireServerAdmin(actor);
        if (!restaurants.existsById(restaurantId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "식당을 찾을 수 없습니다.");
        }
        AppUser user = users.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "등록된 사용자를 찾을 수 없습니다."));
        RestaurantOwner.Id key = new RestaurantOwner.Id(userId, restaurantId);
        if (!owners.existsById(key)) owners.save(new RestaurantOwner(userId, restaurantId));
        return new AdminDtos.OwnerAssignment(user.getId(), user.getEmail(), restaurantId);
    }

    @Transactional
    public AdminDtos.OperationResult revokeOwner(AppUser actor, Long restaurantId, Long userId) {
        authorization.requireServerAdmin(actor);
        RestaurantOwner.Id key = new RestaurantOwner.Id(userId, restaurantId);
        if (!owners.existsById(key)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "업주 권한 연결을 찾을 수 없습니다.");
        }
        owners.deleteById(key);
        return new AdminDtos.OperationResult("업주 권한을 해제했습니다.");
    }
}
