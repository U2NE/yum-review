package com.yumreview.location;

import com.yumreview.auth.SecurityConfig.LocationReverseBodyLimitFilter;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocationReverseBodyLimitFilterTest {
    private static final String PATH = "/api/location/reverse";
    private final LocationReverseBodyLimitFilter filter = new LocationReverseBodyLimitFilter();

    @Test
    void rejectsMissingContentLengthBeforeTheRequestChainRuns() throws Exception {
        MockHttpServletRequest request = reverseRequest();

        assertRejected(invoke(request), 411);
    }

    @Test
    void rejectsUnknownChunkedLengthBeforeTheRequestChainReadsJson() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", PATH) {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setServletPath(PATH);
        request.setContentType("application/json");
        request.addHeader("Transfer-Encoding", "chunked");
        request.setContent("not-json".getBytes(StandardCharsets.UTF_8));

        assertRejected(invoke(request), 411);
    }

    @Test
    void rejectsBodiesOver512BytesBeforeTheRequestChainRuns() throws Exception {
        MockHttpServletRequest request = reverseRequest();
        request.setContent(new byte[513]);
        request.addHeader("Content-Length", "513");

        assertRejected(invoke(request), 413);
    }

    @Test
    void allowsThe512ByteBoundaryToContinueToTheRequestChain() throws Exception {
        MockHttpServletRequest request = reverseRequest();
        request.setContent(new byte[512]);
        request.addHeader("Content-Length", "512");

        Invocation invocation = invoke(request);

        assertTrue(invocation.chainInvoked());
        assertEquals(200, invocation.response().getStatus());
    }

    private Invocation invoke(MockHttpServletRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicBoolean chainInvoked = new AtomicBoolean();
        FilterChain chain = (ignoredRequest, ignoredResponse) -> chainInvoked.set(true);

        filter.doFilter(request, response, chain);
        return new Invocation(response, chainInvoked.get());
    }

    private static MockHttpServletRequest reverseRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", PATH);
        request.setServletPath(PATH);
        request.setContentType("application/json");
        return request;
    }

    private static void assertRejected(Invocation invocation, int status) throws Exception {
        assertFalse(invocation.chainInvoked(), "rejected requests must not reach JSON deserialization");
        assertEquals(status, invocation.response().getStatus());
        assertEquals("no-store", invocation.response().getHeader("Cache-Control"));
        assertEquals("no-cache", invocation.response().getHeader("Pragma"));
        assertTrue(invocation.response().getContentAsString().contains("요청 본문"));
    }

    private record Invocation(MockHttpServletResponse response, boolean chainInvoked) { }
}
