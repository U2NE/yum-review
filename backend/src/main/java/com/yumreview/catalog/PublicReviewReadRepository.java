package com.yumreview.catalog;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Read-only native projections over V1's review table; deliberately independent of Review.java. */
public interface PublicReviewReadRepository extends Repository<Menu, Long> {
    interface MenuAggregate {
        Long getId();
        Long getRestaurantId();
        String getRestaurantName();
        String getName();
        String getDescription();
        Integer getPriceKrw();
        Double getOverallAverage();
        Double getTasteAverage();
        Double getValueAverage();
        Double getPortionAverage();
        Long getReviewCount();
    }

    interface PublicReviewRow {
        Long getId();
        Integer getOverallScore();
        Integer getTasteScore();
        Integer getValueScore();
        Integer getPortionScore();
        String getComment();
        Instant getCreatedAt();
    }

    String AGGREGATE_SELECT = """
            SELECT m.id AS \"id\", r.id AS \"restaurantId\", r.name AS \"restaurantName\",
                   m.name AS \"name\", m.description AS \"description\", m.price_krw AS \"priceKrw\",
                   AVG(rv.overall_score)::double precision AS \"overallAverage\",
                   AVG(rv.taste_score)::double precision AS \"tasteAverage\",
                   AVG(rv.value_score)::double precision AS \"valueAverage\",
                   AVG(rv.portion_score)::double precision AS \"portionAverage\",
                   COUNT(rv.id) AS \"reviewCount\"
            FROM menu m JOIN restaurant r ON r.id = m.restaurant_id
            LEFT JOIN review rv ON rv.menu_id = m.id
            """;

    @Query(value = AGGREGATE_SELECT + """
            WHERE (:q IS NULL OR lower(m.name) LIKE lower(concat('%', :q, '%'))
                   OR lower(r.name) LIKE lower(concat('%', :q, '%')))
            GROUP BY m.id, r.id, r.name
            ORDER BY COUNT(rv.id) DESC, AVG(rv.overall_score) DESC NULLS LAST, m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> searchPopular(@Param("q") String q);

    @Query(value = AGGREGATE_SELECT + """
            WHERE (:q IS NULL OR lower(m.name) LIKE lower(concat('%', :q, '%'))
                   OR lower(r.name) LIKE lower(concat('%', :q, '%')))
            GROUP BY m.id, r.id, r.name
            ORDER BY AVG(rv.overall_score) DESC NULLS LAST, COUNT(rv.id) DESC, m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> searchRating(@Param("q") String q);

    @Query(value = AGGREGATE_SELECT + """
            WHERE m.id = :menuId
            GROUP BY m.id, r.id, r.name
            """, nativeQuery = true)
    java.util.Optional<MenuAggregate> findMenuAggregate(@Param("menuId") Long menuId);

    @Query(value = AGGREGATE_SELECT + """
            WHERE r.id = :restaurantId
            GROUP BY m.id, r.id, r.name
            ORDER BY m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> findRestaurantMenus(@Param("restaurantId") Long restaurantId);

    @Query(value = """
            SELECT rv.id AS \"id\", rv.overall_score AS \"overallScore\",
                   rv.taste_score AS \"tasteScore\", rv.value_score AS \"valueScore\",
                   rv.portion_score AS \"portionScore\", rv.comment AS \"comment\",
                   rv.created_at AS \"createdAt\"
            FROM review rv WHERE rv.menu_id = :menuId
            ORDER BY rv.created_at DESC, rv.id DESC
            """, nativeQuery = true)
    List<PublicReviewRow> findPublicReviews(@Param("menuId") Long menuId);
}
