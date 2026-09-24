package com.yumreview.review;

import com.yumreview.auth.AppUser;
import com.yumreview.catalog.Menu;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(name = "review")
public class Review {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "menu_id", nullable = false)
    private Menu menu;

    @Column(name = "overall_score", nullable = false)
    private short overallScore;

    @Column(name = "taste_score", nullable = false)
    private short tasteScore;

    @Column(name = "value_score", nullable = false)
    private short valueScore;

    @Column(name = "portion_score", nullable = false)
    private short portionScore;

    @Column(length = 1000)
    private String comment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Review() {
    }

    Review(AppUser user, Menu menu, ReviewDtos.ReviewRequest request) {
        this.user = user;
        this.menu = menu;
        apply(request);
        this.createdAt = OffsetDateTime.now();
        this.updatedAt = this.createdAt;
    }

    void apply(ReviewDtos.ReviewRequest request) {
        this.overallScore = request.overallScore().shortValue();
        this.tasteScore = request.tasteScore().shortValue();
        this.valueScore = request.valueScore().shortValue();
        this.portionScore = request.portionScore().shortValue();
        this.comment = request.comment();
        this.updatedAt = OffsetDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public AppUser getUser() {
        return user;
    }

    public Menu getMenu() {
        return menu;
    }

    public int getOverallScore() {
        return overallScore;
    }

    public int getTasteScore() {
        return tasteScore;
    }

    public int getValueScore() {
        return valueScore;
    }

    public int getPortionScore() {
        return portionScore;
    }

    public String getComment() {
        return comment;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }
}
