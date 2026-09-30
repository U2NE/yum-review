package com.yumreview.media;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.sql.DataSource;

/** Exact-run cleanup for the legacy review-media directory. */
@Service
public class ReviewMediaPurgeService {
    public static final String RUN_ID = "yum-overhaul-20260928";
    private static final Pattern REVIEW_FILE = Pattern.compile("review-([0-9a-fA-F-]{36})\\.webp");
    private static final Pattern MENU_FILE = Pattern.compile("menu-([0-9a-fA-F-]{36})\\.webp");
    private static final Pattern TEMP_FILE = Pattern.compile("yum-(?:stage|output)-[A-Za-z0-9_-]{6,64}\\.part");
    private static final int ADVISORY_LOCK_NAMESPACE = 7123341;
    private static final int FREEZE_DRAIN_LOCK = 2810;
    private static final int MEDIA_PURGE_LOCK = 2811;

    private final DataSource dataSource;

    public ReviewMediaPurgeService(DataSource dataSource) { this.dataSource = dataSource; }

    /**
     * Reads the media root and run identity from the process environment. The
     * session-level shared freeze lock prevents a concurrent release while the
     * durable STARTED checkpoint and filesystem work are in flight. A separate
     * project-owner CLI performs the independent final rescan and COMMITTED attestation.
     */
    public PurgeResult purgeExactActiveRun() throws IOException {
        String runId = System.getenv("YUM_PERSONAL_DATA_PURGE_RUN");
        if (!RUN_ID.equals(runId)) throw new IllegalStateException("Exact active purge run is not selected");

        String configuredRoot = System.getenv("YUM_REVIEW_MEDIA_DIR");
        if (configuredRoot == null || configuredRoot.isBlank()) {
            throw new IllegalStateException("YUM_REVIEW_MEDIA_DIR is required");
        }
        String volumeId = System.getenv("YUM_REVIEW_MEDIA_VOLUME_ID");
        if (volumeId == null || !volumeId.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,63}")) {
            throw new IllegalStateException("A stable YUM_REVIEW_MEDIA_VOLUME_ID is required");
        }
        Path configuredPath = Path.of(configuredRoot);
        if (!configuredPath.isAbsolute() || containsTraversal(configuredPath)) {
            throw new IllegalStateException("Review-media root must be an absolute safe path");
        }
        Path root = configuredPath.normalize();
        try (Connection connection = dataSource.getConnection()) {
            boolean purgeLock = false;
            boolean freezeSharedLock = false;
            try {
                purgeLock = trySessionLock(connection, MEDIA_PURGE_LOCK);
                if (!purgeLock) throw new IllegalStateException("Another exact-run media purge command is active");
                sessionLock(connection, "pg_advisory_lock_shared", FREEZE_DRAIN_LOCK);
                freezeSharedLock = true;
                requireExactFrozenRun(connection, runId);

                PurgePlan plan = inspect(root);
                ManifestHashes observed = itemHmacs(connection, runId, plan);
                MediaCheckpoint checkpoint = beginCheckpoint(connection, runId, volumeId, observed);
                requireRetryMatchesOriginal(observed, checkpoint);

                if (!checkpoint.startAttested()) {
                    if (!observed.reviewHmacs().equals(checkpoint.startedReviewHmacs())
                            || !observed.temporaryHmacs().equals(checkpoint.startedTemporaryHmacs())
                            || !observed.menuHmacs().equals(checkpoint.startedMenuHmacs())) {
                        throw new IllegalStateException("The original volume inventory must be attested before cleanup");
                    }
                    throw new IllegalStateException("A separate trusted operator must attest the original volume inventory before cleanup");
                }
                if (!allVolumeInventoriesAttested(connection, runId)) {
                    throw new IllegalStateException("Every enumerated media volume must be attested before cleanup starts");
                }

                if ("COMMITTED".equals(checkpoint.status())) {
                    if (!plan.reviewFiles().isEmpty() || !plan.temporaryFiles().isEmpty()) {
                        throw new IllegalStateException("Committed media checkpoint has remaining review or staging files");
                    }
                    return new PurgeResult(checkpoint.committedReviewFileCount(),
                            checkpoint.committedTemporaryFileCount(), checkpoint.committedMenuFileCount(),
                            checkpoint.committedInventoryHmac(), false);
                }

                // This STARTED record is committed before apply() can unlink the first file.
                PurgeResult applied = apply(plan, checkpoint.startedInventoryHmac());

                PurgePlan after = inspect(root);
                ManifestHashes afterHmacs = itemHmacs(connection, runId, after);
                if (!afterHmacs.reviewHmacs().isEmpty() || !afterHmacs.temporaryHmacs().isEmpty()
                        || !afterHmacs.menuHmacs().equals(checkpoint.startedMenuHmacs())) {
                    throw new IllegalStateException("Legacy media rescan failed; leave the write freeze active");
                }
                return new PurgeResult(applied.reviewFilesDeleted(), applied.temporaryFilesDeleted(),
                        after.menuFiles().size(), checkpoint.startedInventoryHmac(), true);
            } catch (SQLException databaseFailure) {
                throw new IllegalStateException("Legacy media checkpoint failed closed; keep the write freeze active", databaseFailure);
            } finally {
                SQLException unlockFailure = null;
                if (freezeSharedLock) {
                    try { unlockSession(connection, "pg_advisory_unlock_shared", FREEZE_DRAIN_LOCK); }
                    catch (SQLException failure) { unlockFailure = failure; }
                }
                if (purgeLock) {
                    try { unlockSession(connection, "pg_advisory_unlock", MEDIA_PURGE_LOCK); }
                    catch (SQLException failure) { if (unlockFailure == null) unlockFailure = failure; }
                }
                if (unlockFailure != null) {
                    try { connection.abort(Runnable::run); } catch (SQLException ignored) { /* closing below remains the fallback */ }
                    throw new IllegalStateException("Could not release the media purge coordination lock", unlockFailure);
                }
            }
        } catch (SQLException connectionFailure) {
            throw new IllegalStateException("Legacy media purge database is unavailable; no media checkpoint was accepted", connectionFailure);
        }
    }

    private static boolean allVolumeInventoriesAttested(Connection connection, String runId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT public.legacy_personal_data_media_inventory_all_volumes_attested(?)")) {
            statement.setString(1, runId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getBoolean(1);
            }
        }
    }

    private static void requireExactFrozenRun(Connection connection, String runId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT session_user, public.personal_data_write_is_frozen(), "
                        + "public.legacy_personal_data_purge_run_is_active(?), "
                        + "public.legacy_personal_data_media_inventory_verified(?)")) {
            statement.setString(1, runId);
            statement.setString(2, runId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || !"purge_identity".equals(result.getString(1))
                        || !result.getBoolean(2) || !result.getBoolean(3) || !result.getBoolean(4)) {
                    throw new IllegalStateException("Exact-run freeze, purge identity, and all-volume inventory are required");
                }
            }
        }
    }

    private static ManifestHashes itemHmacs(Connection connection, String runId, PurgePlan plan) throws SQLException, IOException {
        Array reviewDigests = connection.createArrayOf("text", itemDigests(plan.reviewFiles()).toArray(String[]::new));
        Array temporaryDigests = connection.createArrayOf("text", itemDigests(plan.temporaryFiles()).toArray(String[]::new));
        Array menuDigests = connection.createArrayOf("text", itemDigests(plan.menuFiles()).toArray(String[]::new));
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT review_hmacs, temporary_hmacs, menu_hmacs "
                        + "FROM public.legacy_personal_data_media_item_hmacs(?, ?, ?, ?)")) {
            statement.setString(1, runId);
            statement.setArray(2, reviewDigests);
            statement.setArray(3, temporaryDigests);
            statement.setArray(4, menuDigests);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new IllegalStateException("The exact-run media item digests could not be keyed");
                return new ManifestHashes(readTextArray(result.getArray(1)), readTextArray(result.getArray(2)),
                        readTextArray(result.getArray(3)));
            }
        } finally {
            reviewDigests.free();
            temporaryDigests.free();
            menuDigests.free();
        }
    }

    private static MediaCheckpoint beginCheckpoint(Connection connection, String runId, String volumeId,
                                                    ManifestHashes hashes) throws SQLException {
        connection.setAutoCommit(false);
        try {
            Array reviewHmacs = connection.createArrayOf("text", hashes.reviewHmacs().toArray(String[]::new));
            Array temporaryHmacs = connection.createArrayOf("text", hashes.temporaryHmacs().toArray(String[]::new));
            Array menuHmacs = connection.createArrayOf("text", hashes.menuHmacs().toArray(String[]::new));
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM public.begin_legacy_review_media_purge(?, ?, ?, ?, ?)")) {
                statement.setString(1, runId);
                statement.setString(2, volumeId);
                statement.setArray(3, reviewHmacs);
                statement.setArray(4, temporaryHmacs);
                statement.setArray(5, menuHmacs);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) throw new IllegalStateException("Legacy media STARTED checkpoint was not returned");
                    MediaCheckpoint checkpoint = new MediaCheckpoint(
                            result.getString("status"), result.getLong("started_review_file_count"),
                            result.getLong("started_temporary_file_count"), result.getLong("started_menu_file_count"),
                            readTextArray(result.getArray("started_review_hmacs")),
                            readTextArray(result.getArray("started_temporary_hmacs")),
                            readTextArray(result.getArray("started_menu_hmacs")),
                            result.getString("started_inventory_hmac"),
                            result.getTimestamp("start_attested_at") != null,
                            result.getString("committed_review_file_count") == null ? null : result.getLong("committed_review_file_count"),
                            result.getString("committed_temporary_file_count") == null ? null : result.getLong("committed_temporary_file_count"),
                            result.getString("committed_menu_file_count") == null ? null : result.getLong("committed_menu_file_count"),
                            result.getString("committed_inventory_hmac"));
                    connection.commit();
                    return checkpoint;
                }
            } finally {
                reviewHmacs.free();
                temporaryHmacs.free();
                menuHmacs.free();
            }
        } catch (SQLException | RuntimeException failure) {
            connection.rollback();
            throw failure;
        } finally {
            connection.setAutoCommit(true);
        }
    }

    static void requireRetryMatchesOriginal(ManifestHashes current, MediaCheckpoint original) {
        if (!isSubset(current.reviewHmacs(), original.startedReviewHmacs())
                || !isSubset(current.temporaryHmacs(), original.startedTemporaryHmacs())
                || !current.menuHmacs().equals(original.startedMenuHmacs())) {
            throw new IllegalStateException("Current media inventory does not match the persisted original checkpoint");
        }
        if (current.reviewHmacs().size() > original.startedReviewFileCount()
                || current.temporaryHmacs().size() > original.startedTemporaryFileCount()
                || current.menuHmacs().size() != original.startedMenuFileCount()) {
            throw new IllegalStateException("Current media counts do not match the persisted original checkpoint");
        }
    }

    private static boolean isSubset(List<String> candidate, List<String> original) {
        Map<String, Integer> remaining = new HashMap<>();
        for (String value : original) remaining.merge(value, 1, Integer::sum);
        for (String value : candidate) {
            int count = remaining.getOrDefault(value, 0);
            if (count == 0) return false;
            if (count == 1) remaining.remove(value);
            else remaining.put(value, count - 1);
        }
        return true;
    }

    private static List<String> readTextArray(Array value) throws SQLException {
        if (value == null) throw new IllegalStateException("Legacy media digest array is missing");
        try {
            Object raw = value.getArray();
            if (!(raw instanceof Object[] elements)) throw new IllegalStateException("Legacy media digest array is invalid");
            List<String> strings = new ArrayList<>(elements.length);
            for (Object element : elements) {
                if (!(element instanceof String text) || !text.matches("[0-9a-f]{64}")) {
                    throw new IllegalStateException("Legacy media digest array is malformed");
                }
                strings.add(text);
            }
            strings.sort(String::compareTo);
            return List.copyOf(strings);
        } finally {
            value.free();
        }
    }

    private static List<String> itemDigests(List<Path> files) throws IOException {
        List<String> digests = new ArrayList<>(files.size());
        for (Path file : files) {
            String item = file.getFileName() + ":" + Files.size(file) + ":" + sha256File(file);
            digests.add(sha256(item));
        }
        digests.sort(String::compareTo);
        return List.copyOf(digests);
    }

    private static boolean trySessionLock(Connection connection, int lockId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT pg_catalog.pg_try_advisory_lock(?, ?)")) {
            statement.setInt(1, ADVISORY_LOCK_NAMESPACE);
            statement.setInt(2, lockId);
            try (ResultSet result = statement.executeQuery()) { return result.next() && result.getBoolean(1); }
        }
    }

    private static void sessionLock(Connection connection, String function, int lockId) throws SQLException {
        if (!"pg_advisory_lock_shared".equals(function)) throw new IllegalArgumentException("Unsupported advisory lock");
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT pg_catalog." + function + "(?, ?)")) {
            statement.setInt(1, ADVISORY_LOCK_NAMESPACE);
            statement.setInt(2, lockId);
            try (ResultSet ignored = statement.executeQuery()) { /* acquire the session lock */ }
        }
    }

    private static void unlockSession(Connection connection, String function, int lockId) throws SQLException {
        if (!"pg_advisory_unlock_shared".equals(function) && !"pg_advisory_unlock".equals(function)) {
            throw new IllegalArgumentException("Unsupported advisory unlock");
        }
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT pg_catalog." + function + "(?, ?)")) {
            statement.setInt(1, ADVISORY_LOCK_NAMESPACE);
            statement.setInt(2, lockId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || !result.getBoolean(1)) throw new SQLException("Advisory lock was not held");
            }
        }
    }

    static void requireInventoryVerified(boolean verified) {
        if (!verified) throw new IllegalStateException("All target instances and media volumes must be verified first");
    }

    static PurgeResult apply(PurgePlan plan, String keyedDigest) throws IOException {
        if (!plan.manifestSha256().equals(sha256(joinManifest(
                plan.reviewFiles(), plan.menuFiles(), plan.temporaryFiles())))) {
            throw new IllegalStateException("Media files changed after durable purge checkpoint; retry reconciliation is required");
        }
        if (!plan.menuManifestSha256().equals(hashFiles(plan.menuFiles()))) {
            throw new IllegalStateException("Retained MENU files changed after media-root preflight");
        }
        int reviewDeleted = deleteFiles(plan.reviewFiles());
        int temporaryDeleted = deleteFiles(plan.temporaryFiles());
        String menuAfter = hashFiles(plan.menuFiles());
        if (!plan.menuManifestSha256().equals(menuAfter)) {
            throw new IllegalStateException("Retained MENU files changed during review-media cleanup");
        }
        return new PurgeResult(reviewDeleted, temporaryDeleted, plan.menuFiles().size(), keyedDigest, false);
    }

    /** Testable filesystem preflight; it performs no deletion. */
    static PurgePlan inspect(Path configuredRoot) throws IOException {
        if (configuredRoot == null || !configuredRoot.isAbsolute()
                || !configuredRoot.normalize().equals(configuredRoot)) {
            throw new IllegalStateException("Review-media root must be an absolute normalized path");
        }
        rejectSymlinkPath(configuredRoot);
        if (!Files.isDirectory(configuredRoot, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(configuredRoot)) {
            throw new IllegalStateException("Configured review-media volume is unreachable");
        }
        Path tmp = configuredRoot.resolve("tmp");
        if (Files.isSymbolicLink(tmp) || !Files.isDirectory(tmp, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException("Dedicated media temporary directory is unavailable");
        }

        List<Path> review = new ArrayList<>();
        List<Path> menu = new ArrayList<>();
        List<Path> temporary = new ArrayList<>();
        try (var entries = Files.newDirectoryStream(configuredRoot)) {
            for (Path child : entries) {
                if (child.equals(tmp)) continue;
                if (Files.isSymbolicLink(child)) throw new IllegalStateException("Media-root symlinks are not allowed");
                String name = child.getFileName().toString();
                if (matchesUuidFile(REVIEW_FILE, name)) review.add(requireRegularDirectChild(configuredRoot, child));
                else if (matchesUuidFile(MENU_FILE, name)) menu.add(requireRegularDirectChild(configuredRoot, child));
                else throw new IllegalStateException("Media root contains an unknown entry");
            }
        }
        try (var entries = Files.newDirectoryStream(tmp)) {
            for (Path child : entries) {
                if (Files.isSymbolicLink(child)) throw new IllegalStateException("Temporary symlinks are not allowed");
                if (!TEMP_FILE.matcher(child.getFileName().toString()).matches()) {
                    throw new IllegalStateException("Temporary directory contains an unknown entry");
                }
                temporary.add(requireRegularDirectChild(tmp, child));
            }
        }

        Comparator<Path> byName = Comparator.comparing(path -> path.getFileName().toString());
        review.sort(byName);
        menu.sort(byName);
        temporary.sort(byName);
        String menuHash = hashFiles(menu);
        String manifest = sha256(joinManifest(review, menu, temporary));
        return new PurgePlan(List.copyOf(review), List.copyOf(menu), List.copyOf(temporary), manifest, menuHash);
    }

    private static Path requireRegularDirectChild(Path parent, Path child) throws IOException {
        if (!parent.equals(child.toAbsolutePath().normalize().getParent())
                || !Files.isRegularFile(child, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException("Only safe direct-child regular files are allowed");
        }
        return child;
    }

    private static boolean matchesUuidFile(Pattern pattern, String filename) {
        var match = pattern.matcher(filename);
        if (!match.matches()) return false;
        try {
            return UUID.fromString(match.group(1)).toString().equalsIgnoreCase(match.group(1));
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    private static void rejectSymlinkPath(Path path) {
        Path current = path.getRoot();
        if (current == null) throw new IllegalStateException("Media root has no filesystem root");
        for (Path component : path) {
            current = current.resolve(component);
            if (Files.isSymbolicLink(current)) throw new IllegalStateException("Media-root path contains a symlink");
        }
    }

    private static boolean containsTraversal(Path path) {
        for (Path component : path) if ("..".equals(component.toString())) return true;
        return false;
    }

    private static String joinManifest(List<Path> review, List<Path> menu, List<Path> temporary) throws IOException {
        StringBuilder value = new StringBuilder();
        for (Path path : review) value.append("review:").append(path.getFileName()).append(':')
                .append(Files.size(path)).append(':').append(sha256File(path)).append('\n');
        for (Path path : menu) value.append("menu:").append(path.getFileName()).append(':')
                .append(Files.size(path)).append(':').append(sha256File(path)).append('\n');
        for (Path path : temporary) value.append("temp:").append(path.getFileName()).append(':')
                .append(Files.size(path)).append(':').append(sha256File(path)).append('\n');
        return value.toString();
    }

    private static int deleteFiles(List<Path> files) throws IOException {
        int removed = 0;
        for (Path file : files) {
            if (Files.isSymbolicLink(file) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
                throw new IllegalStateException("A file changed after media-root preflight");
            }
            if (Files.deleteIfExists(file)) removed++;
        }
        return removed;
    }

    private static String hashFiles(List<Path> files) throws IOException {
        StringBuilder value = new StringBuilder();
        for (Path file : files) {
            value.append(file.getFileName()).append(':').append(sha256File(file)).append('\n');
        }
        return sha256(value.toString());
    }

    private static String sha256File(Path path) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    record PurgePlan(List<Path> reviewFiles, List<Path> menuFiles, List<Path> temporaryFiles,
                     String manifestSha256, String menuManifestSha256) { }
    record ManifestHashes(List<String> reviewHmacs, List<String> temporaryHmacs,
                          List<String> menuHmacs) { }
    record MediaCheckpoint(String status, long startedReviewFileCount, long startedTemporaryFileCount,
                           long startedMenuFileCount, List<String> startedReviewHmacs,
                           List<String> startedTemporaryHmacs, List<String> startedMenuHmacs,
                           String startedInventoryHmac, boolean startAttested, Long committedReviewFileCount,
                           Long committedTemporaryFileCount, Long committedMenuFileCount,
                           String committedInventoryHmac) { }
    public record PurgeResult(long reviewFilesDeleted, long temporaryFilesDeleted,
                              long retainedMenuFiles, String keyedManifestHmac,
                              boolean awaitingTrustedCommit) { }
}
