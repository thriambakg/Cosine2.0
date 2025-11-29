/**
 * Politician Suggestions Service
 * Loads and provides autocomplete suggestions for politician names
 */

export interface Politician {
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName: string;
  party: string;
  state: string;
  district?: string;
  type: 'sen' | 'rep'; // Senator or Representative
  searchText: string; // Combined text for searching
}

class PoliticianSuggestionsService {
  private politicians: Politician[] = [];
  private isLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Load politicians from CSV file
   */
  async loadPoliticians(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this._loadPoliticiansInternal();
    await this.loadingPromise;
  }

  private async _loadPoliticiansInternal(): Promise<void> {
    try {
      console.log('🏛️ Loading politicians data...');
      
      const response = await fetch('/data/congress-legislators.csv');
      if (!response.ok) {
        throw new Error(`Failed to load politicians CSV: ${response.status}`);
      }

      const csvText = await response.text();
      const lines = csvText.split('\n');
      
      if (lines.length < 2) {
        throw new Error('Invalid CSV format');
      }

      // Parse CSV header
      const headers = this._parseCsvLine(lines[0]);
      console.log('📊 CSV Headers:', headers.slice(0, 10)); // Log first 10 headers

      // Find required column indices
      const firstNameIndex = headers.indexOf('first_name');
      const lastNameIndex = headers.indexOf('last_name');
      const middleNameIndex = headers.indexOf('middle_name');
      const fullNameIndex = headers.indexOf('full_name');
      const partyIndex = headers.indexOf('party');
      const stateIndex = headers.indexOf('state');
      const districtIndex = headers.indexOf('district');
      const typeIndex = headers.indexOf('type');

      if (firstNameIndex === -1 || lastNameIndex === -1 || fullNameIndex === -1) {
        throw new Error('Required columns not found in CSV');
      }

      // Parse data rows
      const politicians: Politician[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const values = this._parseCsvLine(line);
          
          const firstName = values[firstNameIndex] || '';
          const lastName = values[lastNameIndex] || '';
          const middleName = values[middleNameIndex] || undefined;
          const fullName = values[fullNameIndex] || `${firstName} ${lastName}`.trim();
          const party = values[partyIndex] || '';
          const state = values[stateIndex] || '';
          const district = values[districtIndex] || undefined;
          const type = values[typeIndex] as 'sen' | 'rep' || 'rep';

          if (!firstName || !lastName) continue;

          // Create searchable text combining all name variants
          const searchText = [
            fullName,
            `${firstName} ${lastName}`,
            `${lastName}, ${firstName}`,
            middleName ? `${firstName} ${middleName} ${lastName}` : '',
          ].filter(Boolean).join(' ').toLowerCase();

          politicians.push({
            firstName,
            lastName,
            middleName,
            fullName,
            party,
            state,
            district,
            type,
            searchText,
          });
        } catch (error) {
          console.warn(`⚠️ Error parsing line ${i + 1}:`, error);
          continue;
        }
      }

      this.politicians = politicians;
      this.isLoaded = true;
      
      console.log(`✅ Loaded ${politicians.length} politicians`);
      console.log('🔍 Sample politicians:', politicians.slice(0, 3));
      
    } catch (error) {
      console.error('❌ Failed to load politicians:', error);
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
   * Get politician suggestions based on search query
   */
  getSuggestions(query: string, maxResults: number = 10): Politician[] {
    if (!this.isLoaded || !query || query.length < 2) {
      return [];
    }

    const searchQuery = query.toLowerCase().trim();
    const suggestions: Array<{ politician: Politician; score: number }> = [];

    for (const politician of this.politicians) {
      let score = 0;
      
      // Exact match on full name gets highest score
      if (politician.fullName.toLowerCase() === searchQuery) {
        score = 100;
      }
      // Starts with query gets high score
      else if (politician.fullName.toLowerCase().startsWith(searchQuery)) {
        score = 90;
      }
      // Last name starts with query gets good score
      else if (politician.lastName.toLowerCase().startsWith(searchQuery)) {
        score = 80;
      }
      // First name starts with query gets decent score
      else if (politician.firstName.toLowerCase().startsWith(searchQuery)) {
        score = 70;
      }
      // Contains query gets lower score
      else if (politician.searchText.includes(searchQuery)) {
        score = 50;
      }

      if (score > 0) {
        suggestions.push({ politician, score });
      }
    }

    // Sort by score (highest first) and return top results
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.politician);
  }

  /**
   * Get all politicians (for development/debugging)
   */
  getAllPoliticians(): Politician[] {
    return [...this.politicians];
  }

  /**
   * Check if politicians are loaded
   */
  isDataLoaded(): boolean {
    return this.isLoaded;
  }
}

// Export singleton instance
export const politicianSuggestionsService = new PoliticianSuggestionsService();
