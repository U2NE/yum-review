package com.yumreview.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.io.Serializable;
import java.util.Objects;

@Entity
@Table(name = "restaurant_owner")
public class RestaurantOwner {
    @EmbeddedId
    private Id id;

    protected RestaurantOwner() { }

    RestaurantOwner(Long userId, Long restaurantId) { this.id = new Id(userId, restaurantId); }

    public Long getUserId() { return id.getUserId(); }
    public Long getRestaurantId() { return id.getRestaurantId(); }

    @Embeddable
    public static class Id implements Serializable {
        @Column(name = "user_id", nullable = false)
        private Long userId;
        @Column(name = "restaurant_id", nullable = false)
        private Long restaurantId;

        protected Id() { }
        public Id(Long userId, Long restaurantId) { this.userId = userId; this.restaurantId = restaurantId; }
        public Long getUserId() { return userId; }
        public Long getRestaurantId() { return restaurantId; }

        @Override public boolean equals(Object other) {
            if (this == other) return true;
            if (!(other instanceof Id that)) return false;
            return Objects.equals(userId, that.userId) && Objects.equals(restaurantId, that.restaurantId);
        }
        @Override public int hashCode() { return Objects.hash(userId, restaurantId); }
    }
}
