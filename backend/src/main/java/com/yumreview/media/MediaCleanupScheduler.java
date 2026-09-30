package com.yumreview.media;

import com.yumreview.auth.PersonalDataWriteGateFilter;
import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MediaCleanupScheduler {
    private static final Logger log = LoggerFactory.getLogger(MediaCleanupScheduler.class);
    private final ImageLifecycleService lifecycle;
    private final PersonalDataWriteGateFilter writeGate;

    @Autowired
    public MediaCleanupScheduler(ImageLifecycleService lifecycle, PersonalDataWriteGateFilter writeGate) {
        this.lifecycle = lifecycle;
        this.writeGate = writeGate;
    }

    MediaCleanupScheduler(ImageLifecycleService lifecycle) {
        this(lifecycle, null);
    }

    @Scheduled(fixedDelayString = "${yum-review.media.cleanup-interval:15m}")
    public void reconcile() {
        if (writeGate != null && writeGate.isFrozen()) return;
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
