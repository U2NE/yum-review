package com.yumreview.auth;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
        return new PasswordEncoder() {
            @Override
            public String encode(CharSequence rawPassword) {
                if (rawPassword == null || utf8Length(rawPassword) > 72) {
                    throw new IllegalArgumentException("Password exceeds BCrypt's 72-byte limit");
                }
                return bcrypt.encode(rawPassword);
            }

            @Override
            public boolean matches(CharSequence rawPassword, String encodedPassword) {
                return rawPassword != null && utf8Length(rawPassword) <= 72
                        && bcrypt.matches(rawPassword, encodedPassword);
            }

            @Override
            public boolean upgradeEncoding(String encodedPassword) {
                return bcrypt.upgradeEncoding(encodedPassword);
            }
        };
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, UserDetailsService userDetailsService) throws Exception {
        http
                .cors(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .csrf(csrf -> csrf
                        .csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                        // /csrf returns an XOR-masked token; this handler decodes
                        // that same representation from the client's header.
                        .csrfTokenRequestHandler(new XorCsrfTokenRequestAttributeHandler()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf", "/api/menus/*/reviews", "/api/menus/**", "/api/restaurants/**", "/api/images/**", "/api/location/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login", "/api/menus/search").permitAll()
                        .anyRequest().authenticated())
                .formLogin(form -> form
                        .loginProcessingUrl("/api/auth/login")
                        .usernameParameter("email")
                        .successHandler((request, response, authentication) ->
                                writeJson(response, HttpServletResponse.SC_OK, "{\"authenticated\":true}"))
                        .failureHandler((request, response, exception) ->
                                writeJson(response, HttpServletResponse.SC_UNAUTHORIZED,
                                        "{\"message\":\"이메일 또는 비밀번호를 확인해 주세요.\"}")))
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .invalidateHttpSession(true)
                        .deleteCookies("JSESSIONID")
                        .logoutSuccessHandler((request, response, authentication) ->
                                writeJson(response, HttpServletResponse.SC_OK, "{\"authenticated\":false}")))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) ->
                                writeJson(response, HttpServletResponse.SC_UNAUTHORIZED,
                                        "{\"message\":\"로그인이 필요합니다.\"}"))
                        .accessDeniedHandler((request, response, exception) ->
                                writeJson(response, HttpServletResponse.SC_FORBIDDEN,
                                        "{\"message\":\"요청 권한 또는 CSRF 토큰을 확인해 주세요.\"}")))
                .userDetailsService(userDetailsService);
        http.addFilterBefore(new ForcedPasswordChangeFilter(), AuthorizationFilter.class);
        return http.build();
    }

    private static final class ForcedPasswordChangeFilter extends OncePerRequestFilter {
        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                        FilterChain chain) throws ServletException, IOException {
            var authentication = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            Object principal = authentication == null ? null : authentication.getPrincipal();
            if (principal instanceof AppUser user && user.isMustChangePassword() && !isAllowed(request)) {
                writeJson(response, HttpServletResponse.SC_FORBIDDEN,
                        "{\"message\":\"계속하려면 먼저 비밀번호를 변경해 주세요.\",\"code\":\"PASSWORD_CHANGE_REQUIRED\"}");
                return;
            }
            chain.doFilter(request, response);
        }

        private static boolean isAllowed(HttpServletRequest request) {
            String path = request.getServletPath();
            String method = request.getMethod();
            return ("GET".equals(method) && ("/api/auth/csrf".equals(path) || "/api/auth/me".equals(path)))
                    || ("POST".equals(method) && "/api/auth/logout".equals(path))
                    || ("PUT".equals(method) && "/api/auth/password".equals(path));
        }
    }

    private static void writeJson(HttpServletResponse response, int status, String body) throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write(body);
    }

    private static int utf8Length(CharSequence value) {
        return value.toString().getBytes(StandardCharsets.UTF_8).length;
    }
}
