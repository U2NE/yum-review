package com.yumreview.media;

import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import com.yumreview.auth.PersonalDataWriteGateFilter;
import jakarta.servlet.Filter;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.Charset;
import java.util.EnumSet;
import java.util.concurrent.Semaphore;

@Configuration
@EnableScheduling
@EnableConfigurationProperties(MediaConfiguration.MediaProperties.class)
public class MediaConfiguration {
    private static final int MAX_BUFFERED_UPLOAD_RESPONSE_BYTES = 64 * 1024;

    @Bean
    Semaphore mediaUploadSemaphore(MediaProperties properties) {
        return new Semaphore(properties.getMaxConcurrentUploads(), true);
    }

    @Bean
    FilterRegistrationBean<Filter> mediaUploadAdmissionFilter(
            Semaphore mediaUploadSemaphore,
            PersonalDataWriteGateFilter writeGate,
            PlatformTransactionManager transactionManager) {
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
            BufferedUploadResponse bufferedResponse = new BufferedUploadResponse(
                    httpResponse, MAX_BUFFERED_UPLOAD_RESPONSE_BYTES);
            try {
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    try {
                        if (writeGate.lockSharedAndIsFrozen()) {
                            writeFreezeResponse(bufferedResponse);
                            return;
                        }
                        chain.doFilter(request, bufferedResponse);
                        bufferedResponse.verifyWithinLimit();
                    } catch (IOException | ServletException failure) {
                        throw new ServletRequestFailure(failure);
                    }
                });
                bufferedResponse.copyBodyToResponse();
            } catch (ServletRequestFailure failure) {
                if (bufferedResponse.overflowed()) {
                    if (httpResponse.isCommitted()) throw failure;
                    httpResponse.reset();
                    writeUploadUnavailableResponse(httpResponse);
                    return;
                }
                if (failure.getCause() instanceof IOException ioFailure) throw ioFailure;
                if (failure.getCause() instanceof ServletException servletFailure) throw servletFailure;
                throw failure;
            } catch (RuntimeException transactionFailure) {
                if (httpResponse.isCommitted()) throw transactionFailure;
                httpResponse.reset();
                writeUploadUnavailableResponse(httpResponse);
            } finally {
                mediaUploadSemaphore.release();
            }
        });
        registration.addUrlPatterns("/api/media");
        registration.setDispatcherTypes(EnumSet.of(DispatcherType.REQUEST, DispatcherType.ERROR));
        registration.setAsyncSupported(false);
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }

    private static final class BufferedUploadResponse extends HttpServletResponseWrapper {
        private final int maximumBytes;
        private final ByteArrayOutputStream body = new ByteArrayOutputStream();
        private final ServletOutputStream outputStream = new ServletOutputStream() {
            @Override public void write(int value) throws IOException { append(new byte[]{(byte) value}, 0, 1); }
            @Override public void write(byte[] value, int offset, int length) throws IOException {
                append(value, offset, length);
            }
            @Override public boolean isReady() { return true; }
            @Override public void setWriteListener(WriteListener listener) {
                throw new IllegalStateException("Asynchronous response writes are disabled for media upload admission");
            }
        };
        private PrintWriter writer;
        private boolean writerRequested;
        private boolean streamRequested;
        private boolean overflow;
        private Integer pendingErrorStatus;
        private String pendingErrorMessage;
        private String pendingRedirect;

        private BufferedUploadResponse(HttpServletResponse response, int maximumBytes) {
            super(response);
            this.maximumBytes = maximumBytes;
        }

        private void append(byte[] value, int offset, int length) throws IOException {
            if (length > maximumBytes - body.size()) {
                overflow = true;
                throw new ResponseBufferLimitFailure();
            }
            body.write(value, offset, length);
        }

        @Override public ServletOutputStream getOutputStream() {
            if (writerRequested) throw new IllegalStateException("getWriter() has already been called");
            streamRequested = true;
            return outputStream;
        }

        @Override public PrintWriter getWriter() {
            if (streamRequested) throw new IllegalStateException("getOutputStream() has already been called");
            writerRequested = true;
            if (writer == null) writer = new PrintWriter(new OutputStreamWriter(outputStream,
                    Charset.forName(getCharacterEncoding())));
            return writer;
        }

        @Override public void flushBuffer() throws IOException {
            if (writer != null) writer.flush();
            verifyWithinLimit();
        }

        @Override public void resetBuffer() {
            if (pendingErrorStatus != null || pendingRedirect != null) {
                throw new IllegalStateException("The upload response has already been terminated");
            }
            body.reset();
            overflow = false;
        }

        @Override public void reset() {
            if (pendingErrorStatus != null || pendingRedirect != null) {
                throw new IllegalStateException("The upload response has already been terminated");
            }
            super.reset();
            body.reset();
            overflow = false;
        }

        @Override public void sendError(int status) {
            resetBuffer();
            pendingErrorStatus = status;
            pendingErrorMessage = null;
        }

        @Override public void sendError(int status, String message) {
            resetBuffer();
            pendingErrorStatus = status;
            pendingErrorMessage = message;
        }

        @Override public void sendRedirect(String location) {
            resetBuffer();
            pendingRedirect = location;
        }

        @Override public boolean isCommitted() {
            return pendingErrorStatus != null || pendingRedirect != null || super.isCommitted();
        }

        private void verifyWithinLimit() throws IOException {
            if (writer != null) writer.flush();
            if (overflow) throw new ResponseBufferLimitFailure();
        }

        private boolean overflowed() { return overflow; }

        private void copyBodyToResponse() throws IOException {
            if (writer != null) writer.flush();
            verifyWithinLimit();
            HttpServletResponse target = (HttpServletResponse) getResponse();
            if (pendingErrorStatus != null) {
                if (pendingErrorMessage == null) target.sendError(pendingErrorStatus);
                else target.sendError(pendingErrorStatus, pendingErrorMessage);
                return;
            }
            if (pendingRedirect != null) {
                target.sendRedirect(pendingRedirect);
                return;
            }
            if (body.size() > 0) {
                target.getOutputStream().write(body.toByteArray());
            }
        }
    }

    private static void writeFreezeResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"code\":\"PERSONAL_DATA_WRITE_FROZEN\",\"message\":\"개인정보 변경을 잠시 중단했습니다.\"}");
    }

    private static void writeUploadUnavailableResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"code\":\"MEDIA_UPLOAD_TEMPORARILY_UNAVAILABLE\",\"message\":\"사진 업로드를 잠시 사용할 수 없습니다.\"}");
    }

    private static final class ResponseBufferLimitFailure extends IOException { }

    private static final class ServletRequestFailure extends RuntimeException {
        private ServletRequestFailure(Exception cause) { super(cause); }
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
