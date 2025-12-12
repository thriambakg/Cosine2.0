/**
 * Policy Area Suggestions Service
 * Loads and provides autocomplete suggestions for policy areas
 */

export interface PolicyArea {
  name: string;
  searchText: string;
}

class PolicyAreaSuggestionsService {
  private policyAreas: PolicyArea[] = [];
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Load policy areas from CSV file
   */
  async loadPolicyAreas(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._loadPolicyAreasInternal();
    await this.loadingPromise;
  }

  private async _loadPolicyAreasInternal(): Promise<void> {
    try {
      console.log('📋 Loading policy areas data...');
      
      const response = await fetch('/data/policy-areas.csv');
      if (!response.ok) {
        throw new Error(`Failed to load policy areas CSV: ${response.status}`);
      }

      const csvText = await response.text();
      const lines = csvText.split('\n');
      
      if (lines.length < 2) {
        throw new Error('Invalid CSV format');
      }

      // Parse CSV header
      const headers = this._parseCsvLine(lines[0]);
      const policyAreaIndex = headers.indexOf('policy_area');

      if (policyAreaIndex === -1) {
        throw new Error('policy_area column not found in CSV');
      }

      // Parse data rows
      const policyAreas: PolicyArea[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const values = this._parseCsvLine(line);
          const name = values[policyAreaIndex]?.trim();
          
          if (!name) continue;

          // Create searchable text (lowercase for matching)
          const searchText = name.toLowerCase();

          policyAreas.push({
            name,
            searchText,
          });
        } catch (error) {
          console.warn(`⚠️ Error parsing line ${i + 1}:`, error);
          continue;
        }
      }

      this.policyAreas = policyAreas;
      this.isLoaded = true;
      
      console.log(`✅ Loaded ${policyAreas.length} policy areas`);
      
    } catch (error) {
      console.error('❌ Failed to load policy areas:', error);
      throw error;
    }
  }

  /**
   * Parse CSV line handling quotes and commas properly
   */
  private _parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add last field
    result.push(current.trim());
    
    return result;
  }

  /**
   * Get policy area suggestions based on search query
   * Returns all policy areas if query is empty, filtered results otherwise
   */
  getSuggestions(query: string, maxResults: number = 20): string[] {
    if (!this.isLoaded) {
      return [];
    }

    // If no query or empty query, return all policy areas (for scrollable dropdown)
    if (!query || query.trim().length === 0) {
      return this.getAllPolicyAreas();
    }

    const searchQuery = query.toLowerCase().trim();
    const suggestions: Array<{ name: string; score: number }> = [];

    for (const policyArea of this.policyAreas) {
      let score = 0;
      
      // Exact match gets highest score
      if (policyArea.name.toLowerCase() === searchQuery) {
        score = 100;
      }
      // Starts with query gets high score
      else if (policyArea.name.toLowerCase().startsWith(searchQuery)) {
        score = 90;
      }
      // Contains query gets lower score
      else if (policyArea.searchText.includes(searchQuery)) {
        score = 50;
      }

      if (score > 0) {
        suggestions.push({ name: policyArea.name, score });
      }
    }

    // If no matches found, return empty array (don't show all when searching)
    if (suggestions.length === 0) {
      return [];
    }

    // Sort by score (highest first) and return top results
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.name);
  }

  /**
   * Get all policy areas
   */
  getAllPolicyAreas(): string[] {
    return this.policyAreas.map(pa => pa.name);
  }

  /**
   * Check if policy areas are loaded
   */
  isDataLoaded(): boolean {
    return this.isLoaded;
  }
}

// Export singleton instance
export const policyAreaSuggestionsService = new PolicyAreaSuggestionsService();
