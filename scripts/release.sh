#!/bin/bash
set -e

# Release helper script for Lace VS Code Extension
# Usage: ./scripts/release.sh [patch|minor|major|<specific-version>]

RELEASE_TYPE="${1:-patch}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🏷️  Lace VS Code Extension Release Script"
echo "=========================================="

# Ensure clean working directory
if ! git diff --quiet HEAD; then
    echo -e "${RED}❌ Error: Working directory is not clean${NC}"
    echo "Please commit or stash your changes before releasing."
    git status --short
    exit 1
fi

# Ensure we're on a branch (not detached HEAD)
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    echo -e "${RED}❌ Error: Not on a branch (detached HEAD)${NC}"
    exit 1
fi

echo "Current branch: $CURRENT_BRANCH"

# Get current version
CURRENT_VERSION=$(jq -r .version package.json)
echo "Current version: $CURRENT_VERSION"

# Calculate new version
if [ "$RELEASE_TYPE" = "patch" ] || [ "$RELEASE_TYPE" = "minor" ] || [ "$RELEASE_TYPE" = "major" ]; then
    # Use npm version to calculate (dry run)
    NEW_VERSION=$(npm version "$RELEASE_TYPE" --no-git-tag-version 2>/dev/null | tail -1)
    # Revert the dry run change
    npm version "$CURRENT_VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1
else
    # Specific version provided
    NEW_VERSION="$RELEASE_TYPE"
fi

echo "New version will be: $NEW_VERSION"
echo ""

# Confirm
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⚠️  Release cancelled${NC}"
    exit 0
fi

# Create release branch
RELEASE_BRANCH="release/v$NEW_VERSION"
echo "Creating release branch: $RELEASE_BRANCH"
git checkout -b "$RELEASE_BRANCH"

# Bump version (updates package.json and package-lock.json)
echo "Bumping version to $NEW_VERSION..."
npm version "$RELEASE_TYPE" --no-git-tag-version

# Show changes
echo ""
echo -e "${GREEN}✅ Version bumped to $NEW_VERSION${NC}"
echo ""
echo "Changes to be committed:"
git diff --cached --stat

# Commit
echo ""
echo "Creating commit..."
git add package.json package-lock.json
git commit -m "$NEW_VERSION"

echo ""
echo -e "${GREEN}✅ Release branch created and committed${NC}"
echo ""

# Push the branch
echo "Pushing to origin..."
git push -u origin "$RELEASE_BRANCH"

# Get repo URL for PR link
REPO_URL=$(git remote get-url origin 2>/dev/null | sed 's/git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')
if [ -n "$REPO_URL" ]; then
    PR_URL="$REPO_URL/compare/main...$RELEASE_BRANCH?expand=1"
    echo ""
    echo -e "${GREEN}🚀 Release branch pushed!${NC}"
    echo ""
    echo "Create PR: $PR_URL"
fi

echo ""
echo "Next steps:"
echo "  1. Create a PR to main (link above ↑)"
echo "  2. Get review and merge the PR"
echo "  3. CI will automatically:"
echo "     - Create tag v$NEW_VERSION"
echo "     - Publish to VS Code Marketplace"
echo "     - Create GitHub Release"
echo ""
