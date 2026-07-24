/**
 * Indexed candidate retrieval and deterministic relevance tiers for public product
 * search. The only interpolated value is a positional-parameter number owned by route
 * code; user input always stays in pg's values array.
 */
export function buildMarketplaceSearchCtes(parameterIndex: number) {
  if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 1) {
    throw new Error("Search parameter index must be a positive integer");
  }
  const parameter = `$${parameterIndex}`;

  return `
    search_input as materialized (
      select
        marketplace_search_normalize(${parameter}::text) as normalized,
        plainto_tsquery(
          'simple',
          marketplace_search_normalize(${parameter}::text)
        ) as full_text_query
    ),
    trigram_matches as materialized (
      select
        terms.product_id,
        max(similarity(terms.term, search_input.normalized))::float
          as trigram_similarity
      from marketplace_product_search_terms terms
      cross join search_input
      where terms.term % search_input.normalized
      group by terms.product_id
    ),
    search_candidate_ids as materialized (
      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.normalized_title = search_input.normalized

      union

      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.normalized_title like search_input.normalized || '%'

      union

      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.normalized_game_aliases
        @> array[search_input.normalized]::text[]

      union

      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.normalized_game_name = search_input.normalized

      union

      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.normalized_category_aliases
        @> array[search_input.normalized]::text[]

      union

      select trigram_matches.product_id
      from trigram_matches

      union

      select documents.product_id
      from marketplace_product_search_documents documents
      cross join search_input
      where documents.document_vector @@ search_input.full_text_query
    ),
    search_matches as materialized (
      select
        documents.product_id,
        case
          when documents.normalized_title = search_input.normalized then 1
          when documents.normalized_title like search_input.normalized || '%' then 2
          when documents.normalized_game_aliases
            @> array[search_input.normalized]::text[] then 3
          when documents.normalized_game_name = search_input.normalized then 4
          when trigram_matches.product_id is not null
            or documents.normalized_category_aliases
              @> array[search_input.normalized]::text[] then 5
          else 6
        end as relevance_tier,
        coalesce(trigram_matches.trigram_similarity, 0)::float
          as trigram_similarity,
        ts_rank_cd(
          documents.document_vector,
          search_input.full_text_query
        )::float as full_text_rank
      from search_candidate_ids candidates
      join marketplace_product_search_documents documents
        on documents.product_id = candidates.product_id
      cross join search_input
      left join trigram_matches
        on trigram_matches.product_id = documents.product_id
    )
  `;
}

export const MARKETPLACE_SEARCH_SELECT = `
  search_match.relevance_tier as "searchRelevanceTier",
  search_match.trigram_similarity as "searchSimilarity",
  search_match.full_text_rank as "searchFullTextRank",
`;

export const MARKETPLACE_SEARCH_JOIN = `
  join search_matches search_match on search_match.product_id = p.id
`;

export const MARKETPLACE_SEARCH_GROUP_BY = `
  , search_match.product_id, search_match.relevance_tier,
    search_match.trigram_similarity, search_match.full_text_rank
`;

export const MARKETPLACE_SEARCH_ORDER_BY = `
  "searchRelevanceTier" asc,
  "searchSimilarity" desc,
  "searchFullTextRank" desc,
  "salesCount" desc,
  "createdAt" desc,
  id asc
`;
