package com.yumreview.media;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(name = "media_asset")
public class StoredImage {
    static final String ACTIVE = "ACTIVE";
    static final String REVOKED = "REVOKED";
    static final String DELETE_PENDING = "DELETE_PENDING";

    @Id
    @Column(name = "media_id", nullable = false, length = 64)
    private String mediaId;

    @Column(name = "storage_key", nullable = false, unique = true, length = 255)
    private String storageKey;

    @Column(name = "uploaded_by_user_id", nullable = false)
    private Long uploadedByUserId;

    @Column(name = "content_type", nullable = false, length = 120)
    private String contentType;

    @Column(name = "original_bytes", nullable = false)
    private long originalBytes;

    @Column(name = "stored_bytes", nullable = false)
    private long storedBytes;

    @Column(name = "sha256_hex", nullable = false, length = 64)
    private String sha256Hex;

    @Column(name = "provenance", nullable = false, length = 24)
    private String provenance;

    @Column(name = "rights_basis", nullable = false, length = 500)
    private String rightsBasis;

    @Column(name = "rights_attested_at", nullable = false)
    private OffsetDateTime rightsAttestedAt;

    @Column(name = "rights_attested_by_user_id", nullable = false)
    private Long rightsAttestedByUserId;

    @Column(name = "lifecycle_status", nullable = false, length = 24)
    private String lifecycleStatus = ACTIVE;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected StoredImage() { }

    static StoredImage uploaded(String mediaId, String storageKey, Long userId,
                                long originalBytes, long storedBytes, String sha256Hex,
                                String provenance, String rightsBasis, OffsetDateTime now) {
        StoredImage image = new StoredImage();
        image.mediaId = mediaId;
        image.storageKey = storageKey;
        image.uploadedByUserId = userId;
        image.contentType = "image/webp";
        image.originalBytes = originalBytes;
        image.storedBytes = storedBytes;
        image.sha256Hex = sha256Hex;
        image.provenance = provenance;
        image.rightsBasis = rightsBasis;
        image.rightsAttestedAt = now;
        image.rightsAttestedByUserId = userId;
        image.lifecycleStatus = ACTIVE;
        image.createdAt = now;
        return image;
    }

    void markDeletePending() {
        if (!DELETE_PENDING.equals(lifecycleStatus)) lifecycleStatus = DELETE_PENDING;
    }

    void markRevoked() {
        lifecycleStatus = REVOKED;
    }

    public String getMediaId() { return mediaId; }
    public String getStorageKey() { return storageKey; }
    public Long getUploadedByUserId() { return uploadedByUserId; }
    public String getContentType() { return contentType; }
    public long getOriginalBytes() { return originalBytes; }
    public long getStoredBytes() { return storedBytes; }
    public String getSha256Hex() { return sha256Hex; }
    public String getProvenance() { return provenance; }
    public String getRightsBasis() { return rightsBasis; }
    public OffsetDateTime getRightsAttestedAt() { return rightsAttestedAt; }
    public Long getRightsAttestedByUserId() { return rightsAttestedByUserId; }
    public String getLifecycleStatus() { return lifecycleStatus; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
