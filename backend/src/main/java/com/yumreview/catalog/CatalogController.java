package com.yumreview.catalog;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import static com.yumreview.catalog.CatalogDtos.*;

@RestController
@RequestMapping("/api")
public class CatalogController {
    private final CatalogService catalog;

    public CatalogController(CatalogService catalog) { this.catalog = catalog; }

    @GetMapping("/menus")
    public List<MenuCard> searchMenus(@RequestParam(required = false) String q,
                                      @RequestParam(defaultValue = "popular") String sort) {
        return catalog.searchMenus(q, sort);
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

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public org.springframework.http.ResponseEntity<ApiError> badRequest(
            org.springframework.web.server.ResponseStatusException exception) {
        HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
        return org.springframework.http.ResponseEntity.status(status)
                .body(new ApiError(status.value(), status.name(), exception.getReason()));
    }
}
