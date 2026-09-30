package com.yumreview.auth;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PersonalDataWriteFreezeTest {
    @Test
    void activeFreezeRejectsApiWritesWithNoStoreResponse() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(true);
        PersonalDataWriteGateFilter filter = new PersonalDataWriteGateFilter(jdbc);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/reviews");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertEquals(503, response.getStatus());
        assertEquals("no-store", response.getHeader("Cache-Control"));
        assertTrue(response.getContentAsString().contains("PERSONAL_DATA_WRITE_FROZEN"));
        assertNull(chain.getRequest());
    }

    @Test
    void readsContinueWhileFrozenWithoutQueryingTheGate() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PersonalDataWriteGateFilter filter = new PersonalDataWriteGateFilter(jdbc);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/menus");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertEquals(request, chain.getRequest());
        assertEquals(200, response.getStatus());
        verify(jdbc, never()).queryForObject(anyString(), eq(Boolean.class));
    }

    @Test
    void postBasedCatalogSearchRemainsReadableDuringFreeze() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PersonalDataWriteGateFilter filter = new PersonalDataWriteGateFilter(jdbc);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/menus/search");
        request.setServletPath("/api/menus/search");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertEquals(request, chain.getRequest());
        assertEquals(200, response.getStatus());
        verify(jdbc, never()).queryForObject(anyString(), eq(Boolean.class));
    }

    @Test
    void unavailableGateFailsClosedForWrites() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class)))
                .thenThrow(new DataAccessResourceFailureException("unavailable"));
        PersonalDataWriteGateFilter filter = new PersonalDataWriteGateFilter(jdbc);

        assertTrue(filter.isFrozen());
    }

    @Test
    void inactiveFreezeAllowsWrites() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(false);
        PersonalDataWriteGateFilter filter = new PersonalDataWriteGateFilter(jdbc);

        assertFalse(filter.isFrozen());
    }
}
