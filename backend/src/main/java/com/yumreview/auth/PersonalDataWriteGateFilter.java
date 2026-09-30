package com.yumreview.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** App-level write gate; the Flyway triggers remain the authoritative SQL boundary. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public final class PersonalDataWriteGateFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(PersonalDataWriteGateFilter.class);
    private final JdbcTemplate jdbcTemplate;

    public PersonalDataWriteGateFilter(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** A missing gate row or unavailable schema fails closed for writes. */
    public boolean isFrozen() {
        try {
            Boolean frozen = jdbcTemplate.queryForObject(
                    "SELECT public.personal_data_write_is_frozen()", Boolean.class);
            return !Boolean.FALSE.equals(frozen);
        } catch (DataAccessException failure) {
            log.warn("Personal-data write gate is unavailable; writes remain blocked");
            return true;
        }
    }

    /** Call inside a Spring transaction before touching media bytes or guarded rows. */
    public boolean lockSharedAndIsFrozen() {
        try {
            jdbcTemplate.execute("SELECT pg_catalog.pg_advisory_xact_lock_shared(7123341, 2810)");
            Boolean frozen = jdbcTemplate.queryForObject(
                    "SELECT public.personal_data_write_is_frozen()", Boolean.class);
            return !Boolean.FALSE.equals(frozen);
        } catch (DataAccessException failure) {
            log.warn("Personal-data write gate is unavailable; writes remain blocked");
            return true;
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String method = request.getMethod();
        boolean safeMethod = "GET".equalsIgnoreCase(method)
                || "HEAD".equalsIgnoreCase(method)
                || "OPTIONS".equalsIgnoreCase(method);
        String path = request.getServletPath();
        boolean readOnlyPost = "POST".equalsIgnoreCase(method)
                && ("/api/menus/search".equals(path)
                    || "/api/location/reverse".equals(path)
                    || "/api/auth/login".equals(path)
                    || "/api/auth/logout".equals(path));
        boolean write = !safeMethod && !readOnlyPost;
        if (!write || !isFrozen()) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"code\":\"PERSONAL_DATA_WRITE_FROZEN\",\"message\":\"개인정보 변경을 잠시 중단했습니다.\"}");
    }
}
