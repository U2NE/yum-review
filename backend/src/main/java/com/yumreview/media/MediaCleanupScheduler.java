package com.yumreview.media;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MediaCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(MediaCleanupScheduler.class);
    private final ImageLifecycleService lifecycle;

    public MediaCleanupScheduler(ImageLifecycleService lifecycle) {
        this.lifecycle = lifecycle;
    }

    @Scheduled(fixedDelayString = "${yum-review.media.cleanup-interval:15m}")
    public void reconcile() {
        int marked = lifecycle.markAgedUnattachedImagesForDeletion();
        int removed = lifecycle.retryPendingDeletes();
        int temporary = lifecycle.cleanStaleTemporaryFiles();
        int orphanFiles = lifecycle.cleanAgedOrphanFiles();
        if (marked > 0 || removed > 0 || temporary > 0 || orphanFiles > 0) {
            log.info("Media cleanup completed; marked={}, removed={}, staleTemporaryFiles={}, orphanFiles={}",
                    marked, removed, temporary, orphanFiles);
        }
    }
}
