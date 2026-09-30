package com.yumreview.media;

import com.yumreview.auth.PersonalDataWriteGateFilter;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MediaConfigurationFreezeDrainTest {
    @Test
    void sharedDrainTransactionStartsBeforeMultipartHandlingAndEndsAfterCleanup() throws Exception {
        List<String> events = new ArrayList<>();
        AtomicBoolean transactionOpen = new AtomicBoolean();
        PlatformTransactionManager transactionManager = transactionManager(events, transactionOpen);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(invocation -> { events.add("shared-drain-lock"); return null; })
                .when(jdbc).execute(anyString());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenAnswer(invocation -> {
            events.add("freeze-check");
            return false;
        });
        Filter filter = uploadFilter(new PersonalDataWriteGateFilter(jdbc), transactionManager);

        MockHttpServletResponse response = invoke(filter, (request, wrappedResponse) -> {
            assertTrue(transactionOpen.get(), "upload handling must remain inside the lock transaction");
            events.add("multipart-parse-and-stage-cleanup");
            ((HttpServletResponse) wrappedResponse).setStatus(201);
            wrappedResponse.getWriter().write("uploaded");
        });

        assertEquals(List.of("transaction-begin", "shared-drain-lock", "freeze-check",
                "multipart-parse-and-stage-cleanup", "transaction-commit"), events);
        assertFalse(transactionOpen.get());
        assertEquals(201, response.getStatus());
        assertEquals("uploaded", response.getContentAsString());
    }

    @Test
    void activeFreezeRejectsBeforeMultipartChainCanParseOrStage() throws Exception {
        List<String> events = new ArrayList<>();
        AtomicBoolean transactionOpen = new AtomicBoolean();
        PlatformTransactionManager transactionManager = transactionManager(events, transactionOpen);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(invocation -> { events.add("shared-drain-lock"); return null; })
                .when(jdbc).execute(anyString());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenAnswer(invocation -> {
            events.add("freeze-check");
            return true;
        });
        Filter filter = uploadFilter(new PersonalDataWriteGateFilter(jdbc), transactionManager);

        MockHttpServletResponse response = invoke(filter, (request, wrappedResponse) ->
                events.add("must-not-parse-or-stage"));

        assertEquals(List.of("transaction-begin", "shared-drain-lock", "freeze-check", "transaction-commit"), events);
        assertEquals(503, response.getStatus());
        assertTrue(response.getContentAsString().contains("PERSONAL_DATA_WRITE_FROZEN"));
    }

    @Test
    void oversizedBufferedResponseRollsBackAndReturnsBoundedUnavailableResponse() throws Exception {
        List<String> events = new ArrayList<>();
        AtomicBoolean transactionOpen = new AtomicBoolean();
        PlatformTransactionManager transactionManager = transactionManager(events, transactionOpen);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(invocation -> { events.add("shared-drain-lock"); return null; })
                .when(jdbc).execute(anyString());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenAnswer(invocation -> {
            events.add("freeze-check");
            return false;
        });
        Filter filter = uploadFilter(new PersonalDataWriteGateFilter(jdbc), transactionManager);

        MockHttpServletResponse response = invoke(filter, (request, wrappedResponse) -> {
            ((HttpServletResponse) wrappedResponse).setStatus(201);
            wrappedResponse.getWriter().write("x".repeat(64 * 1024 + 1));
        });

        assertEquals(503, response.getStatus());
        assertTrue(response.getContentAsString().contains("MEDIA_UPLOAD_TEMPORARILY_UNAVAILABLE"));
        assertTrue(response.getContentLength() < 64 * 1024);
        assertEquals("transaction-rollback", events.getLast());
        assertFalse(transactionOpen.get());
    }

    @Test
    void sendErrorIsReplayedAfterDrainTransactionSoContainerErrorDispatchIsPreserved() throws Exception {
        List<String> events = new ArrayList<>();
        AtomicBoolean transactionOpen = new AtomicBoolean();
        PlatformTransactionManager transactionManager = transactionManager(events, transactionOpen);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doAnswer(invocation -> { events.add("shared-drain-lock"); return null; })
                .when(jdbc).execute(anyString());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(false);
        Filter filter = uploadFilter(new PersonalDataWriteGateFilter(jdbc), transactionManager);
        MockHttpServletResponse response = new MockHttpServletResponse() {
            @Override public void sendError(int status, String message) throws java.io.IOException {
                events.add("servlet-send-error");
                super.sendError(status, message);
            }
        };

        filter.doFilter(request(), response, (request, wrappedResponse) -> {
            wrappedResponse.getWriter().write("discard this body");
            ((HttpServletResponse) wrappedResponse).sendError(413, "payload too large");
        });

        assertTrue(events.indexOf("transaction-commit") < events.indexOf("servlet-send-error"));
        assertEquals(413, response.getStatus());
        assertEquals("payload too large", response.getErrorMessage());
        assertEquals("", response.getContentAsString());
    }

    private static Filter uploadFilter(PersonalDataWriteGateFilter gate,
                                       PlatformTransactionManager transactionManager) {
        FilterRegistrationBean<Filter> registration = new MediaConfiguration()
                .mediaUploadAdmissionFilter(new Semaphore(1, true), gate, transactionManager);
        return registration.getFilter();
    }

    private static MockHttpServletResponse invoke(Filter filter, FilterChain chain) throws Exception {
        MockHttpServletRequest request = request();
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        return response;
    }

    private static MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/media");
        request.setServletPath("/api/media");
        request.setContentType("multipart/form-data; boundary=test");
        return request;
    }

    private static PlatformTransactionManager transactionManager(List<String> events,
                                                                  AtomicBoolean transactionOpen) {
        PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenAnswer(invocation -> {
            events.add("transaction-begin");
            transactionOpen.set(true);
            return new SimpleTransactionStatus();
        });
        doAnswer(invocation -> {
            events.add("transaction-commit");
            transactionOpen.set(false);
            return null;
        }).when(manager).commit(any(TransactionStatus.class));
        doAnswer(invocation -> {
            events.add("transaction-rollback");
            transactionOpen.set(false);
            return null;
        }).when(manager).rollback(any(TransactionStatus.class));
        return manager;
    }
}
