export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      items: {
        Row: {
          id: string;
          name: string;
          name_simplified: string | null;
          item_type: 'item' | 'pet';
          item_id: number | null;
          item_level: number | null; // 5=普通, 6=银, 7=金
          base_image_number: number | null;
          created_at: string;
          updated_at: string;
          // Deal-spotter additions (migration 20260510000001)
          is_auto_discovered: boolean;
          median_gold_value: number | null;
          median_crystal_value: number | null;
          min_sold_gold: number | null;
          min_sold_crystal: number | null;
          max_sold_gold: number | null;
          max_sold_crystal: number | null;
          sample_count_gold: number | null;
          sample_count_crystal: number | null;
          image_path: string | null;
          last_history_refresh: string | null;
          trend6m_cache: Json | null;
          trend6m_cached_at: string | null;
          fair_value_gold: number | null;
          fair_value_source: string | null;
          fair_value_exchange_rate: number | null;
          fair_value_computed_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          name_simplified?: string | null;
          item_type: 'item' | 'pet';
          item_id?: number | null;
          item_level?: number | null;
          base_image_number?: number | null;
          created_at?: string;
          updated_at?: string;
          is_auto_discovered?: boolean;
          median_gold_value?: number | null;
          median_crystal_value?: number | null;
          min_sold_gold?: number | null;
          min_sold_crystal?: number | null;
          max_sold_gold?: number | null;
          max_sold_crystal?: number | null;
          sample_count_gold?: number | null;
          sample_count_crystal?: number | null;
          image_path?: string | null;
          last_history_refresh?: string | null;
          trend6m_cache?: Json | null;
          trend6m_cached_at?: string | null;
          fair_value_gold?: number | null;
          fair_value_source?: string | null;
          fair_value_exchange_rate?: number | null;
          fair_value_computed_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          name_simplified?: string | null;
          item_type?: 'item' | 'pet';
          item_id?: number | null;
          item_level?: number | null;
          base_image_number?: number | null;
          created_at?: string;
          updated_at?: string;
          is_auto_discovered?: boolean;
          median_gold_value?: number | null;
          median_crystal_value?: number | null;
          min_sold_gold?: number | null;
          min_sold_crystal?: number | null;
          max_sold_gold?: number | null;
          max_sold_crystal?: number | null;
          sample_count_gold?: number | null;
          sample_count_crystal?: number | null;
          image_path?: string | null;
          last_history_refresh?: string | null;
          trend6m_cache?: Json | null;
          trend6m_cached_at?: string | null;
          fair_value_gold?: number | null;
          fair_value_source?: string | null;
          fair_value_exchange_rate?: number | null;
          fair_value_computed_at?: string | null;
        };
        Relationships: [];
      };
      price_snapshots: {
        Row: {
          id: string;
          item_id: string;
          price: number;
          pricetype: number;
          server: number;
          stall_name: string;
          stall_cdkey: string;
          coords: string;
          quantity: number;
          source: 'market' | 'transaction';
          listing_key: string | null;
          transaction_id: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          price: number;
          pricetype: number;
          server: number;
          stall_name: string;
          stall_cdkey: string;
          coords: string;
          quantity?: number;
          source: 'market' | 'transaction';
          listing_key?: string | null;
          transaction_id?: number | null;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          price?: number;
          pricetype?: number;
          server?: number;
          stall_name?: string;
          stall_cdkey?: string;
          coords?: string;
          quantity?: number;
          source?: 'market' | 'transaction';
          listing_key?: string | null;
          transaction_id?: number | null;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'price_snapshots_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          }
        ];
      };
      exchange_rates: {
        Row: {
          id: string;
          rate_date: string;
          gold_per_crystal: number;
          source_item_name: string | null;
          source_item_price: number | null;
          source_type: 'market' | 'transaction' | null;
          sample_count: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          rate_date: string;
          gold_per_crystal: number;
          source_item_name?: string | null;
          source_item_price?: number | null;
          source_type?: 'market' | 'transaction' | null;
          sample_count?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          rate_date?: string;
          gold_per_crystal?: number;
          source_item_name?: string | null;
          source_item_price?: number | null;
          source_type?: 'market' | 'transaction' | null;
          sample_count?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_price_summary: {
        Row: {
          id: string;
          item_id: string;
          summary_date: string;
          gold_avg_price: number | null;
          gold_min_price: number | null;
          gold_max_price: number | null;
          gold_listing_count: number;
          gold_total_quantity: number;
          crystal_avg_price: number | null;
          crystal_min_price: number | null;
          crystal_max_price: number | null;
          crystal_listing_count: number;
          crystal_total_quantity: number;
          combined_avg_gold: number | null;
          combined_min_gold: number | null;
          combined_max_gold: number | null;
          total_listing_count: number;
          total_quantity: number;
          exchange_rate_used: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          summary_date: string;
          gold_avg_price?: number | null;
          gold_min_price?: number | null;
          gold_max_price?: number | null;
          gold_listing_count?: number;
          gold_total_quantity?: number;
          crystal_avg_price?: number | null;
          crystal_min_price?: number | null;
          crystal_max_price?: number | null;
          crystal_listing_count?: number;
          crystal_total_quantity?: number;
          combined_avg_gold?: number | null;
          combined_min_gold?: number | null;
          combined_max_gold?: number | null;
          total_listing_count?: number;
          total_quantity?: number;
          exchange_rate_used?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          summary_date?: string;
          gold_avg_price?: number | null;
          gold_min_price?: number | null;
          gold_max_price?: number | null;
          gold_listing_count?: number;
          gold_total_quantity?: number;
          crystal_avg_price?: number | null;
          crystal_min_price?: number | null;
          crystal_max_price?: number | null;
          crystal_listing_count?: number;
          crystal_total_quantity?: number;
          combined_avg_gold?: number | null;
          combined_min_gold?: number | null;
          combined_max_gold?: number | null;
          total_listing_count?: number;
          total_quantity?: number;
          exchange_rate_used?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_price_summary_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          }
        ];
      };
      tracked_items: {
        Row: {
          id: string;
          item_id: string;
          alert_threshold: number;
          target_price: number | null;
          price_override: number | null;
          is_active: boolean;
          created_at: string;
          last_checked: string;
          last_alert_at: string | null;
        };
        Insert: {
          id?: string;
          item_id: string;
          alert_threshold?: number;
          target_price?: number | null;
          price_override?: number | null;
          is_active?: boolean;
          created_at?: string;
          last_checked?: string;
          last_alert_at?: string | null;
        };
        Update: {
          id?: string;
          item_id?: string;
          alert_threshold?: number;
          target_price?: number | null;
          price_override?: number | null;
          is_active?: boolean;
          created_at?: string;
          last_checked?: string;
          last_alert_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tracked_items_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: true;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          }
        ];
      };
      price_statistics: {
        Row: {
          id: string;
          item_id: string;
          avg_price_gold: number | null;
          min_price_7d: number | null;
          max_price_7d: number | null;
          transaction_count_7d: number | null;
          last_seen_price: number | null;
          last_seen_pricetype: number | null;
          last_seen_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          avg_price_gold?: number | null;
          min_price_7d?: number | null;
          max_price_7d?: number | null;
          transaction_count_7d?: number | null;
          last_seen_price?: number | null;
          last_seen_pricetype?: number | null;
          last_seen_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          avg_price_gold?: number | null;
          min_price_7d?: number | null;
          max_price_7d?: number | null;
          transaction_count_7d?: number | null;
          last_seen_price?: number | null;
          last_seen_pricetype?: number | null;
          last_seen_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'price_statistics_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: true;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          }
        ];
      };
      pet_calc_profiles: {
        Row: {
          id: string;
          name: string;
          saved_at: string;
          profile_data: Record<string, unknown>;
          pet_name: string | null;
          level: number;
          card_rank: number;
          mod_grade: number;
          rate: number;
          rand_sum: number | null;
          is_reversed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          saved_at?: string;
          profile_data: Record<string, unknown>;
          pet_name?: string | null;
          level?: number;
          card_rank?: number;
          mod_grade?: number;
          rate?: number;
          rand_sum?: number | null;
          is_reversed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          saved_at?: string;
          profile_data?: Record<string, unknown>;
          pet_name?: string | null;
          level?: number;
          card_rank?: number;
          mod_grade?: number;
          rate?: number;
          rand_sum?: number | null;
          is_reversed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      scan_logs: {
        Row: {
          id: string;
          scan_type: string;
          items_scanned: number;
          prices_recorded: number;
          started_at: string;
          completed_at: string | null;
          status: 'running' | 'completed' | 'failed';
          error_message: string | null;
        };
        Insert: {
          id?: string;
          scan_type: string;
          items_scanned?: number;
          prices_recorded?: number;
          started_at: string;
          completed_at?: string | null;
          status: 'running' | 'completed' | 'failed';
          error_message?: string | null;
        };
        Update: {
          id?: string;
          scan_type?: string;
          items_scanned?: number;
          prices_recorded?: number;
          started_at?: string;
          completed_at?: string | null;
          status?: 'running' | 'completed' | 'failed';
          error_message?: string | null;
        };
        Relationships: [];
      };
      saved_searches: {
        Row: {
          id: string;
          term: string;
          exact: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          term: string;
          exact?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          term?: string;
          exact?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      update_price_statistics: {
        Args: { p_item_id: string };
        Returns: undefined;
      };
      update_daily_price_summary: {
        Args: { p_date?: string };
        Returns: number;
      };
      update_exchange_rate_from_item: {
        Args: { p_crystal_price: number; p_source_type?: string };
        Returns: number;
      };
      upsert_market_listing: {
        Args: {
          p_item_id: string;
          p_price: number;
          p_pricetype: number;
          p_server: number;
          p_stall_name: string;
          p_stall_cdkey: string;
          p_coords: string;
          p_quantity?: number;
        };
        Returns: string;
      };
      upsert_transaction: {
        Args: {
          p_item_id: string;
          p_transaction_id: number;
          p_price: number;
          p_pricetype: number;
          p_stall_name: string;
          p_stall_cdkey: string;
          p_quantity?: number;
          p_recorded_at?: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Convenience types for use in components
export type Item = Database['public']['Tables']['items']['Row'];
export type ItemInsert = Database['public']['Tables']['items']['Insert'];

export type PriceSnapshot = Database['public']['Tables']['price_snapshots']['Row'];
export type PriceSnapshotInsert = Database['public']['Tables']['price_snapshots']['Insert'];

export type TrackedItem = Database['public']['Tables']['tracked_items']['Row'];
export type TrackedItemInsert = Database['public']['Tables']['tracked_items']['Insert'];

export type PriceStatistics = Database['public']['Tables']['price_statistics']['Row'];

export type ScanLog = Database['public']['Tables']['scan_logs']['Row'];
export type ScanLogInsert = Database['public']['Tables']['scan_logs']['Insert'];

export type ExchangeRate = Database['public']['Tables']['exchange_rates']['Row'];
export type ExchangeRateInsert = Database['public']['Tables']['exchange_rates']['Insert'];

export type DailyPriceSummary = Database['public']['Tables']['daily_price_summary']['Row'];
export type DailyPriceSummaryInsert = Database['public']['Tables']['daily_price_summary']['Insert'];

// Joined types for queries
export interface TrackedItemWithDetails extends TrackedItem {
  items: Item;
  price_statistics: PriceStatistics | null;
}
