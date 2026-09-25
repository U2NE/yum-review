package com.yumreview.catalog;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MenuRepository extends JpaRepository<Menu, Long> {
    List<Menu> findAllByRestaurant_IdOrderByIdAsc(Long restaurantId);
    boolean existsByIdAndActiveTrue(Long id);
}
