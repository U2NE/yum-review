package com.yumreview.review;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    boolean existsByUser_IdAndMenu_Id(Long userId, Long menuId);

    List<Review> findAllByUser_IdOrderByUpdatedAtDesc(Long userId);
}
