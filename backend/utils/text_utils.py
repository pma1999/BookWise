"""
String utilities for book title/author matching against OpenLibrary results.
"""
import unicodedata
import re


def levenshtein_distance(s1: str, s2: str) -> int:
    """Compute Levenshtein distance between two strings (DP O(m×n))."""
    m, n = len(s1), len(s2)
    if m == 0:
        return n
    if n == 0:
        return m

    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    return dp[m][n]


_LEADING_ARTICLES = re.compile(
    r'^(el|la|los|las|the|a|an|un|una|le|les|los|das|der|die)\s+',
    re.IGNORECASE
)


def normalize_title(title: str) -> str:
    """
    Normalize a book title for comparison:
    - lowercase + strip
    - remove subtitle (everything after ':')
    - remove leading articles in Spanish / English / French / German
    """
    if not title:
        return ''
    title = title.lower().strip()
    # Remove subtitle
    if ':' in title:
        title = title[:title.index(':')].strip()
    # Remove leading article
    title = _LEADING_ARTICLES.sub('', title).strip()
    return title


def title_similarity(t1: str, t2: str) -> float:
    """
    Return a similarity score [0, 1] between two book titles.
    1.0 if one is a substring of the other (after normalization).
    Otherwise: 1 - levenshtein / max_length.
    """
    n1 = normalize_title(t1)
    n2 = normalize_title(t2)

    if not n1 or not n2:
        return 0.0

    if n1 in n2 or n2 in n1:
        return 1.0

    dist = levenshtein_distance(n1, n2)
    max_len = max(len(n1), len(n2))
    return 1.0 - dist / max_len


def normalize_author(author: str) -> str:
    """
    Normalize an author name:
    - NFKD decomposition to remove diacritics/accents
    - lowercase + strip
    """
    if not author:
        return ''
    nfkd = unicodedata.normalize('NFKD', author)
    ascii_str = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_str.lower().strip()


def author_matches(gemini_author: str, ol_authors: list) -> bool:
    """
    Return True if the Gemini author name matches any author in the OpenLibrary list.
    Matching strategy:
    1. Substring match after normalization (full name contained in each other)
    2. Significant token overlap (last name must be among common tokens)
    """
    if not ol_authors:
        return False

    norm_gemini = normalize_author(gemini_author)
    gemini_tokens = set(norm_gemini.split())

    for ol_author in ol_authors:
        norm_ol = normalize_author(ol_author)

        # Substring match
        if norm_gemini in norm_ol or norm_ol in norm_gemini:
            return True

        # Token overlap — at least one significant token (len > 2) in common
        ol_tokens = set(norm_ol.split())
        common = gemini_tokens & ol_tokens
        significant = {t for t in common if len(t) > 2}
        if significant:
            return True

    return False
