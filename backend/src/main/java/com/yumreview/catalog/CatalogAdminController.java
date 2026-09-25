package com.yumreview.catalog;

import com.yumreview.auth.AppUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.yumreview.catalog.CatalogDtos.*;

@RestController
@RequestMapping("/api")
public class CatalogAdminController {
    private final CatalogAdminService admin;

    public CatalogAdminController(CatalogAdminService admin) { this.admin = admin; }

    @GetMapping("/restaurants/{restaurantId}/manage/menus")
    public List<MenuManagementItem> listMenus(@AuthenticationPrincipal AppUser actor,
                                               @PathVariable Long restaurantId) {
        return admin.listMenus(actor, restaurantId);
    }

    @PostMapping("/restaurants/{restaurantId}/menus")
    @ResponseStatus(HttpStatus.CREATED)
    public MenuManagementItem createMenu(@AuthenticationPrincipal AppUser actor,
                                         @PathVariable Long restaurantId,
                                         @Valid @RequestBody MenuWriteRequest request) {
        return admin.createMenu(actor, restaurantId, request);
    }

    @PutMapping("/menus/{menuId}")
    public MenuManagementItem updateMenu(@AuthenticationPrincipal AppUser actor,
                                         @PathVariable Long menuId,
                                         @Valid @RequestBody MenuWriteRequest request) {
        return admin.updateMenu(actor, menuId, request);
    }

    @DeleteMapping("/menus/{menuId}")
    public OperationResult deactivateMenu(@AuthenticationPrincipal AppUser actor,
                                          @PathVariable Long menuId) {
        return admin.deactivateMenu(actor, menuId);
    }
}
