/**
 * Fine-grained access permissions beyond the isAdmin flag.
 * Add emails to the relevant list to grant feature access to non-admin users.
 */

const SOLUTION_REVIEW_ALLOWED_EMAILS = [
    'user2@hyrank.com',
];

/**
 * Returns true if the user can access solution review pages and their APIs.
 * Admins always pass; specific non-admin emails are whitelisted above.
 */
export function canAccessSolutionReview(user) {
    if (!user) return false;
    return user.isAdmin || SOLUTION_REVIEW_ALLOWED_EMAILS.includes(user.email);
}
