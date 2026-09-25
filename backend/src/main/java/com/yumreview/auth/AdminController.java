package com.yumreview.auth;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminService admin;

    public AdminController(AdminService admin) { this.admin = admin; }

    @GetMapping("/owners")
    public List<AdminDtos.OwnerAssignment> owners(@AuthenticationPrincipal AppUser actor) {
        return admin.listOwners(actor);
    }

    @GetMapping("/users")
    public List<AdminDtos.UserOption> users(@AuthenticationPrincipal AppUser actor,
                                            @RequestParam("q") String query) {
        return admin.searchUsers(actor, query);
    }

    @PostMapping("/restaurants/{restaurantId}/owners")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminDtos.OwnerAssignment assign(@AuthenticationPrincipal AppUser actor,
                                            @PathVariable Long restaurantId,
                                            @Valid @RequestBody AdminDtos.AssignOwnerRequest request) {
        return admin.assignOwner(actor, restaurantId, request.userId());
    }

    @DeleteMapping("/restaurants/{restaurantId}/owners/{userId}")
    public AdminDtos.OperationResult revoke(@AuthenticationPrincipal AppUser actor,
                                             @PathVariable Long restaurantId,
                                             @PathVariable Long userId) {
        return admin.revokeOwner(actor, restaurantId, userId);
    }
}
