package com.yumreview.media;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewMediaPurgeServiceTest {
    @TempDir Path temp;

    @Test
    void onlyReviewAndDedicatedTemporaryFilesAreDeletedAndMenuBytesRemainExact() throws Exception {
        Path root = Files.createDirectory(temp.resolve("media"));
        Path tmp = Files.createDirectory(root.resolve("tmp"));
        Path review = Files.write(root.resolve("review-" + UUID.randomUUID() + ".webp"), new byte[]{1, 2, 3});
        Path menu = Files.write(root.resolve("menu-" + UUID.randomUUID() + ".webp"), new byte[]{9, 8, 7, 6});
        Path staged = Files.write(tmp.resolve("yum-stage-fixture123.part"), new byte[]{4, 5});

        var result = ReviewMediaPurgeService.apply(ReviewMediaPurgeService.inspect(root), "a".repeat(64));

        assertEquals(1, result.reviewFilesDeleted());
        assertEquals(1, result.temporaryFilesDeleted());
        assertEquals(1, result.retainedMenuFiles());
        assertFalse(Files.exists(review));
        assertFalse(Files.exists(staged));
        assertTrue(Files.exists(menu));
        assertArrayEquals(new byte[]{9, 8, 7, 6}, Files.readAllBytes(menu));
    }

    @Test
    void rejectsUnknownEntriesBeforeDeletingAnyReviewFile() throws Exception {
        Path root = fixtureRoot();
        Path review = Files.write(root.resolve("review-" + UUID.randomUUID() + ".webp"), new byte[]{1});
        Files.write(root.resolve("unknown.bin"), new byte[]{2});

        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.inspect(root));
        assertTrue(Files.exists(review));
    }

    @Test
    void rejectsChangedReviewBytesAfterCheckpointAndBeforeDeletion() throws Exception {
        Path root = fixtureRoot();
        Path review = Files.write(root.resolve("review-" + UUID.randomUUID() + ".webp"), new byte[]{1});
        var plan = ReviewMediaPurgeService.inspect(root);
        Files.write(review, new byte[]{9, 9});

        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.apply(plan, "a".repeat(64)));
        assertTrue(Files.exists(review));
    }

    @Test
    void rejectsTraversalAndSubdirectories() throws Exception {
        Path root = fixtureRoot();
        assertThrows(IllegalStateException.class,
                () -> ReviewMediaPurgeService.inspect(root.resolve("..")));
        Files.createDirectory(root.resolve("unexpected"));
        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.inspect(root));
    }

    @Test
    void rejectsUnknownTemporaryFilesBeforeDeletion() throws Exception {
        Path root = fixtureRoot();
        Path review = Files.write(root.resolve("review-" + UUID.randomUUID() + ".webp"), new byte[]{1});
        Files.write(root.resolve("tmp").resolve("menu-" + UUID.randomUUID() + ".webp"), new byte[]{2});

        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.inspect(root));
        assertTrue(Files.exists(review));
    }

    @Test
    void retryMayReconcileOnlyOriginalReviewAndTemporaryManifestItems() {
        var original = new ReviewMediaPurgeService.MediaCheckpoint("STARTED", 2, 1, 1,
                List.of("a".repeat(64), "b".repeat(64)), List.of("c".repeat(64)),
                List.of("d".repeat(64)), "e".repeat(64), true, null, null, null, null);

        ReviewMediaPurgeService.requireRetryMatchesOriginal(
                new ReviewMediaPurgeService.ManifestHashes(
                        List.of("b".repeat(64)), List.of("c".repeat(64)), List.of("d".repeat(64))), original);

        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.requireRetryMatchesOriginal(
                new ReviewMediaPurgeService.ManifestHashes(
                        List.of("f".repeat(64)), List.of("c".repeat(64)), List.of("d".repeat(64))), original));
        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.requireRetryMatchesOriginal(
                new ReviewMediaPurgeService.ManifestHashes(
                        List.of("b".repeat(64)), List.of("c".repeat(64)), List.of("g".repeat(64))), original));
    }

    @Test
    void doesNotProceedWhenAnyVolumeOrInstanceInventoryIsUnavailable() throws Exception {
        Path root = fixtureRoot();
        Path review = Files.write(root.resolve("review-" + UUID.randomUUID() + ".webp"), new byte[]{1});

        assertThrows(IllegalStateException.class,
                () -> ReviewMediaPurgeService.requireInventoryVerified(false));
        assertTrue(Files.exists(review));
    }

    @Test
    void rejectsSymlinkEntriesWhenTheFilesystemSupportsSymlinks() throws Exception {
        Path root = fixtureRoot();
        Path outside = Files.write(temp.resolve("outside.webp"), new byte[]{1});
        try {
            Files.createSymbolicLink(root.resolve("review-" + UUID.randomUUID() + ".webp"), outside);
        } catch (UnsupportedOperationException | IOException | SecurityException unavailable) {
            org.junit.jupiter.api.Assumptions.abort("Symlink creation is unavailable on this test filesystem");
        }
        assertThrows(IllegalStateException.class, () -> ReviewMediaPurgeService.inspect(root));
        assertTrue(Files.exists(outside));
    }

    private Path fixtureRoot() throws IOException {
        Path root = Files.createDirectory(temp.resolve("media-" + UUID.randomUUID()));
        Files.createDirectory(root.resolve("tmp"));
        return root;
    }
}
