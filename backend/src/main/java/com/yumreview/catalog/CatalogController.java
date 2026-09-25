package com.yumreview.catalog;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static com.yumreview.catalog.CatalogDtos.*;

@RestController
@RequestMapping("/api")
public class CatalogController {
    private final CatalogService catalog;

    public CatalogController(CatalogService catalog) { this.catalog = catalog; }

    @GetMapping("/menus")
    public MenuSearchResponse searchMenus(@RequestParam(required = false) String q,
                                         @RequestParam(required = false) String category,
                                         @RequestParam(required = false) String region,
                                         @RequestParam(defaultValue = "overall") String sort) {
        return catalog.searchMenus(q, category, region, null, null, null, sort);
    }

    @PostMapping("/menus/search")
    public MenuSearchResponse nearbyMenuSearch(@RequestBody MenuSearchRequest request) {
        return catalog.searchMenus(request.q(), request.category(), request.region(),
                request.latitude(), request.longitude(), request.radiusMeters(), request.sort());
    }

    @GetMapping("/restaurants/{id}")
    public RestaurantDetail restaurant(@PathVariable Long id) { return catalog.getRestaurant(id); }

    @GetMapping("/menus/{id}")
    public MenuDetail menu(@PathVariable Long id) { return catalog.getMenu(id); }

    @GetMapping("/menus/{id}/reviews")
    public List<PublicReview> reviews(@PathVariable Long id) { return catalog.getMenuReviews(id); }

    @ExceptionHandler(CatalogService.CatalogNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiError notFound(CatalogService.CatalogNotFoundException exception) {
        return new ApiError(404, "NOT_FOUND", exception.getMessage());
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> badRequest(ResponseStatusException exception) {
        HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
        return ResponseEntity.status(status)
                .body(new ApiError(status.value(), status.name(), exception.getReason()));
    }
}
