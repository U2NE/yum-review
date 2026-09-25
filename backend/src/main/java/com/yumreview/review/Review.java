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

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

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

    @Column(name = "overall_score", nullable = false, precision = 2, scale = 1)
    private BigDecimal overallScore;

    @Column(name = "taste_score", nullable = false, precision = 2, scale = 1)
    private BigDecimal tasteScore;

    @Column(name = "value_score", nullable = false, precision = 2, scale = 1)
    private BigDecimal valueScore;

    @Column(name = "portion_score", nullable = false, precision = 2, scale = 1)
    private BigDecimal portionScore;

    @Column(name = "non_event_review_consent")
    private Boolean nonEventReviewConsent;

    @Column(length = 1000)
    private String comment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Review() { }

    Review(AppUser user, Menu menu, ReviewDtos.ReviewRequest request) {
        this.user = user;
        this.menu = menu;
        apply(request);
        this.createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        this.updatedAt = this.createdAt;
    }

    void apply(ReviewDtos.ReviewRequest request) {
        this.overallScore = request.overallScore();
        this.tasteScore = request.tasteScore();
        this.valueScore = request.valueScore();
        this.portionScore = request.portionScore();
        this.nonEventReviewConsent = request.nonEventReviewConsent();
        this.comment = request.comment() == null || request.comment().isBlank()
                ? null : request.comment().trim();
        this.updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    public Long getId() { return id; }
    public AppUser getUser() { return user; }
    public Menu getMenu() { return menu; }
    public BigDecimal getOverallScore() { return overallScore; }
    public BigDecimal getTasteScore() { return tasteScore; }
    public BigDecimal getValueScore() { return valueScore; }
    public BigDecimal getPortionScore() { return portionScore; }
    public Boolean getNonEventReviewConsent() { return nonEventReviewConsent; }
    public String getComment() { return comment; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
