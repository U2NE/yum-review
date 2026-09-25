package com.yumreview.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RestaurantOwnerRepository extends JpaRepository<RestaurantOwner, RestaurantOwner.Id> {
    List<RestaurantOwner> findByIdUserId(Long userId);
    List<RestaurantOwner> findByIdRestaurantId(Long restaurantId);
    boolean existsByIdUserIdAndIdRestaurantId(Long userId, Long restaurantId);
    boolean existsByIdUserId(Long userId);
}
