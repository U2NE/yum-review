package com.yumreview.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "menu")
public class Menu {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "restaurant_id", nullable = false)
    private Restaurant restaurant;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(length = 1000)
    private String description;

    @Column(name = "price_krw")
    private Integer priceKrw;

    @Enumerated(EnumType.STRING)
    @Column(name = "cuisine_category", nullable = false, length = 24)
    private CuisineCategory cuisineCategory = CuisineCategory.OTHER;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "photo_media_id", length = 64)
    private String photoMediaId;

    @Column(name = "photo_url", length = 500)
    private String photoUrl;

    protected Menu() { }

    Menu(Restaurant restaurant, String name, String description, Integer priceKrw,
         CuisineCategory cuisineCategory) {
        this.restaurant = restaurant;
        apply(name, description, priceKrw, cuisineCategory, null);
        this.active = true;
    }

    void apply(String name, String description, Integer priceKrw,
               CuisineCategory cuisineCategory, Boolean active) {
        this.name = name;
        this.description = description;
        this.priceKrw = priceKrw;
        this.cuisineCategory = cuisineCategory;
        if (active != null) this.active = active;
    }

    void setPhotoMediaId(String photoMediaId) { this.photoMediaId = photoMediaId; }

    public Long getId() { return id; }
    public Restaurant getRestaurant() { return restaurant; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public Integer getPriceKrw() { return priceKrw; }
    public CuisineCategory getCuisineCategory() { return cuisineCategory; }
    public boolean isActive() { return active; }
    public String getPhotoMediaId() { return photoMediaId; }
    public String getPhotoUrl() { return photoUrl; }

    public enum CuisineCategory {
        KOREAN, WESTERN, CHINESE, JAPANESE, SNACK, PUB, CAFE, OTHER
    }
}
