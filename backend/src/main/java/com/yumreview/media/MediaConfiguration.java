package com.yumreview.media;

import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Semaphore;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(MediaConfiguration.MediaProperties.class)
public class MediaConfiguration {
    @Bean
    Semaphore mediaUploadSemaphore(MediaProperties properties) {
        return new Semaphore(properties.getMaxConcurrentUploads(), true);
    }

    @Bean
    FilterRegistrationBean<Filter> mediaUploadAdmissionFilter(Semaphore mediaUploadSemaphore) {
        FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>();
        registration.setFilter((request, response, chain) -> {
            var httpRequest = (jakarta.servlet.http.HttpServletRequest) request;
            var httpResponse = (HttpServletResponse) response;
            boolean upload = "POST".equalsIgnoreCase(httpRequest.getMethod())
                    && httpRequest.getContentType() != null
                    && httpRequest.getContentType().toLowerCase(java.util.Locale.ROOT)
                            .startsWith(MediaType.MULTIPART_FORM_DATA_VALUE);
            if (!upload) {
                chain.doFilter(request, response);
                return;
            }
            if (!mediaUploadSemaphore.tryAcquire()) {
                httpResponse.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
                httpResponse.setCharacterEncoding("UTF-8");
                httpResponse.setContentType(MediaType.APPLICATION_JSON_VALUE);
                httpResponse.getWriter().write("{\"message\":\"사진 업로드가 많습니다. 잠시 후 다시 시도해 주세요.\"}");
                return;
            }
            try {
                chain.doFilter(request, response);
            } finally {
                mediaUploadSemaphore.release();
            }
        });
        registration.addUrlPatterns("/api/media");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    @Bean
    ApplicationRunner prepareMediaDirectories(MediaProperties properties) {
        return arguments -> {
            Files.createDirectories(properties.getDirectoryPath());
            Files.createDirectories(properties.getTemporaryDirectory());
        };
    }

    @ConfigurationProperties(prefix = "yum-review.media")
    public static class MediaProperties {
        private String directory = "./var/media";
        private long maxUploadBytes = 99_999_999L;
        private long optimizeTargetBytes = 10_000_000L;
        private long maxDecodedPixels = 16_000_000L;
        private int maxConcurrentUploads = 2;
        private String cleanupInterval = "15m";
        private String pendingDeleteGrace = "1m";
        private String unattachedImageGrace = "24h";
        private String stagingFileGrace = "1h";

        public String getDirectory() { return directory; }
        public void setDirectory(String directory) { this.directory = directory; }
        public long getMaxUploadBytes() { return maxUploadBytes; }
        public void setMaxUploadBytes(long maxUploadBytes) { this.maxUploadBytes = maxUploadBytes; }
        public long getOptimizeTargetBytes() { return optimizeTargetBytes; }
        public void setOptimizeTargetBytes(long optimizeTargetBytes) { this.optimizeTargetBytes = optimizeTargetBytes; }
        public long getMaxDecodedPixels() { return maxDecodedPixels; }
        public void setMaxDecodedPixels(long maxDecodedPixels) { this.maxDecodedPixels = maxDecodedPixels; }
        public int getMaxConcurrentUploads() { return maxConcurrentUploads; }
        public void setMaxConcurrentUploads(int maxConcurrentUploads) { this.maxConcurrentUploads = maxConcurrentUploads; }
        public String getCleanupInterval() { return cleanupInterval; }
        public void setCleanupInterval(String cleanupInterval) { this.cleanupInterval = cleanupInterval; }
        public String getPendingDeleteGrace() { return pendingDeleteGrace; }
        public void setPendingDeleteGrace(String pendingDeleteGrace) { this.pendingDeleteGrace = pendingDeleteGrace; }
        public String getUnattachedImageGrace() { return unattachedImageGrace; }
        public void setUnattachedImageGrace(String unattachedImageGrace) { this.unattachedImageGrace = unattachedImageGrace; }
        public String getStagingFileGrace() { return stagingFileGrace; }
        public void setStagingFileGrace(String stagingFileGrace) { this.stagingFileGrace = stagingFileGrace; }

        public Path getDirectoryPath() {
            return Path.of(directory).toAbsolutePath().normalize();
        }

        public Path getTemporaryDirectory() {
            return getDirectoryPath().resolve("tmp").normalize();
        }
    }
}
