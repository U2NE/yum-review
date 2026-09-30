package com.yumreview.media;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Operator-only, disabled-by-default entry point. It accepts no media path,
 * glob, file name, or row identifier; the service reads the configured root.
 */
@Component
@ConditionalOnProperty(name = "yum-review.media.review-purge.enabled", havingValue = "true")
public final class ReviewMediaPurgeCommand implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ReviewMediaPurgeCommand.class);
    private final ReviewMediaPurgeService purge;

    public ReviewMediaPurgeCommand(ReviewMediaPurgeService purge) {
        this.purge = purge;
    }

    @Override
    public void run(ApplicationArguments arguments) throws Exception {
        if (!arguments.getNonOptionArgs().isEmpty()) {
            throw new IllegalArgumentException("The review-media purge command accepts no positional arguments");
        }
        ReviewMediaPurgeService.PurgeResult result = purge.purgeExactActiveRun();
        log.info("Exact-run review media cleanup status={}; reviewFilesDeleted={}, temporaryFilesDeleted={}, "
                        + "retainedMenuFiles={}, trustedOperatorRescanRequired={}, keyedManifestHmac={}",
                result.awaitingTrustedCommit() ? "awaiting trusted operator rescan" : "committed",
                result.reviewFilesDeleted(), result.temporaryFilesDeleted(), result.retainedMenuFiles(),
                result.awaitingTrustedCommit(), result.keyedManifestHmac());
    }
}
