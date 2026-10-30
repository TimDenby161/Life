export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_balance_history: {
        Row: {
          account_id: string
          as_of: string
          balance_minor: number
          breakdown: Json | null
          created_at: string
          created_by: string
          household_id: string
          id: string
          note: string | null
          source: string
        }
        Insert: {
          account_id: string
          as_of: string
          balance_minor: number
          breakdown?: Json | null
          created_at?: string
          created_by?: string
          household_id: string
          id?: string
          note?: string | null
          source?: string
        }
        Update: {
          account_id?: string
          as_of?: string
          balance_minor?: number
          breakdown?: Json | null
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          note?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balance_history_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "account_balance_history_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "account_balance_history_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount_minor: number
          category_id: string
          created_at: string
          created_by: string
          currency: string
          ends_month: string | null
          household_id: string
          id: string
          starts_month: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          category_id: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_month?: string | null
          household_id: string
          id?: string
          starts_month: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          category_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          ends_month?: string | null
          household_id?: string
          id?: string
          starts_month?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_household_id_fkey"
            columns: ["category_id", "household_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_integrations: {
        Row: {
          color: string
          created_at: string
          created_by: string
          embed_url: string | null
          enabled: boolean
          google_calendar_id: string | null
          hidden_event_titles: string[]
          household_id: string
          id: string
          mode: string
          name: string
          provider: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string
          embed_url?: string | null
          enabled?: boolean
          google_calendar_id?: string | null
          hidden_event_titles?: string[]
          household_id: string
          id?: string
          mode?: string
          name: string
          provider?: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          embed_url?: string | null
          enabled?: boolean
          google_calendar_id?: string | null
          hidden_event_titles?: string[]
          household_id?: string
          id?: string
          mode?: string
          name?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_integrations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          household_id: string
          id: string
          post_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          household_id: string
          id?: string
          post_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          household_id?: string
          id?: string
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_comments_household_id_author_id_fkey"
            columns: ["household_id", "author_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "feed_comments_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_comments_post_id_household_id_fkey"
            columns: ["post_id", "household_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      feed_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          household_id: string
          id: string
          metadata: Json
          summary: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          household_id: string
          id?: string
          metadata?: Json
          summary: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          household_id?: string
          id?: string
          metadata?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          household_id: string
          id: string
          pinned_at: string | null
          pinned_by: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          edited_at?: string | null
          household_id: string
          id?: string
          pinned_at?: string | null
          pinned_by?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          household_id?: string
          id?: string
          pinned_at?: string | null
          pinned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_posts_household_id_author_id_fkey"
            columns: ["household_id", "author_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "feed_posts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_posts_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_reads: {
        Row: {
          household_id: string
          post_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          household_id: string
          post_id: string
          read_at?: string
          user_id?: string
        }
        Update: {
          household_id?: string
          post_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_reads_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_reads_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "feed_reads_post_id_household_id_fkey"
            columns: ["post_id", "household_id"]
            isOneToOne: false
            referencedRelation: "feed_posts"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      feed_sources: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          enabled: boolean
          household_id: string
          id: string
          name: string
          provider: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string
          enabled?: boolean
          household_id: string
          id?: string
          name: string
          provider: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          enabled?: boolean
          household_id?: string
          id?: string
          name?: string
          provider?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_categories: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          household_id: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          household_id: string
          id?: string
          kind: string
          name: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sheet_links: {
        Row: {
          account_id: string
          created_at: string
          household_id: string
          id: string
          label: string | null
          row_key: string
        }
        Insert: {
          account_id: string
          created_at?: string
          household_id: string
          id?: string
          label?: string | null
          row_key: string
        }
        Update: {
          account_id?: string
          created_at?: string
          household_id?: string
          id?: string
          label?: string | null
          row_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_sheet_links_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "finance_sheet_links_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "finance_sheet_links_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_sheet_sources: {
        Row: {
          created_at: string
          created_by: string
          enabled: boolean
          household_id: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          name: string
          sheet_name: string
          skipped_row_keys: string[]
          spreadsheet_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          enabled?: boolean
          household_id: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          name?: string
          sheet_name?: string
          skipped_row_keys?: string[]
          spreadsheet_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          enabled?: boolean
          household_id?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          name?: string
          sheet_name?: string
          skipped_row_keys?: string[]
          spreadsheet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_sheet_sources_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_accounts: {
        Row: {
          account_type: string
          archived_at: string | null
          color: string
          created_at: string
          created_by: string
          currency: string
          external_account_id: string | null
          external_provider: string | null
          household_id: string
          id: string
          include_in_net_worth: boolean
          institution: string | null
          is_liability: boolean | null
          name: string
          opening_balance_minor: number
          opening_date: string
          owner_id: string | null
          ownership: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_type: string
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string
          currency?: string
          external_account_id?: string | null
          external_provider?: string | null
          household_id: string
          id?: string
          include_in_net_worth?: boolean
          institution?: string | null
          is_liability?: boolean | null
          name: string
          opening_balance_minor?: number
          opening_date?: string
          owner_id?: string | null
          ownership: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_type?: string
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string
          currency?: string
          external_account_id?: string | null
          external_provider?: string | null
          household_id?: string
          id?: string
          include_in_net_worth?: boolean
          institution?: string | null
          is_liability?: boolean | null
          name?: string
          opening_balance_minor?: number
          opening_date?: string
          owner_id?: string | null
          ownership?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_accounts_household_id_owner_id_fkey"
            columns: ["household_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          account_id: string
          amount_minor: number
          category_id: string | null
          created_at: string
          created_by: string
          description: string
          external_id: string | null
          household_id: string
          id: string
          import_batch_id: string | null
          kind: string
          notes: string | null
          occurred_on: string
          source: string
          transfer_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_minor: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          description: string
          external_id?: string | null
          household_id: string
          id?: string
          import_batch_id?: string | null
          kind: string
          notes?: string | null
          occurred_on: string
          source?: string
          transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_minor?: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          external_id?: string | null
          household_id?: string
          id?: string
          import_batch_id?: string | null
          kind?: string
          notes?: string | null
          occurred_on?: string
          source?: string
          transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "financial_transactions_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "financial_transactions_category_id_household_id_fkey"
            columns: ["category_id", "household_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "financial_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      health_exercise_sessions: {
        Row: {
          created_at: string
          description: string
          duration_minutes: number
          external_id: string | null
          household_id: string
          id: string
          logged_by: string | null
          source: string
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          duration_minutes: number
          external_id?: string | null
          household_id: string
          id?: string
          logged_by?: string | null
          source?: string
          started_at: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          duration_minutes?: number
          external_id?: string | null
          household_id?: string
          id?: string
          logged_by?: string | null
          source?: string
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_exercise_sessions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_exercise_sessions_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "health_exercise_sessions_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_measurements: {
        Row: {
          category: string
          created_at: string
          external_id: string | null
          household_id: string
          id: string
          measured_at: string
          metric_id: string
          notes: string | null
          source: string
          unit: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          category?: string
          created_at?: string
          external_id?: string | null
          household_id: string
          id?: string
          measured_at?: string
          metric_id: string
          notes?: string | null
          source?: string
          unit?: string
          updated_at?: string
          user_id?: string
          value: number
        }
        Update: {
          category?: string
          created_at?: string
          external_id?: string | null
          household_id?: string
          id?: string
          measured_at?: string
          metric_id?: string
          notes?: string | null
          source?: string
          unit?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_measurements_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_measurements_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "health_measurements_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "health_metric_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      health_metric_definitions: {
        Row: {
          aggregation: string
          category: string
          created_at: string
          decimals: number
          household_id: string | null
          id: string
          key: string
          name: string
          owner_id: string | null
          sort_order: number
          unit: string
        }
        Insert: {
          aggregation?: string
          category: string
          created_at?: string
          decimals?: number
          household_id?: string | null
          id?: string
          key: string
          name: string
          owner_id?: string | null
          sort_order?: number
          unit: string
        }
        Update: {
          aggregation?: string
          category?: string
          created_at?: string
          decimals?: number
          household_id?: string | null
          id?: string
          key?: string
          name?: string
          owner_id?: string | null
          sort_order?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_metric_definitions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_metric_definitions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_periods: {
        Row: {
          created_at: string
          ended_on: string | null
          household_id: string
          id: string
          notes: string | null
          started_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_on?: string | null
          household_id: string
          id?: string
          notes?: string | null
          started_on: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ended_on?: string | null
          household_id?: string
          id?: string
          notes?: string | null
          started_on?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_periods_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_periods_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          household_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          household_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          default_currency: string
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      language_progress: {
        Row: {
          created_at: string
          due_on: string
          household_id: string
          id: string
          interval_days: number
          item: string
          kind: string
          language: string
          lapses: number
          last_reviewed_on: string | null
          learned_on: string
          reviews: number
          user_id: string
        }
        Insert: {
          created_at?: string
          due_on: string
          household_id: string
          id?: string
          interval_days?: number
          item: string
          kind: string
          language: string
          lapses?: number
          last_reviewed_on?: string | null
          learned_on: string
          reviews?: number
          user_id?: string
        }
        Update: {
          created_at?: string
          due_on?: string
          household_id?: string
          id?: string
          interval_days?: number
          item?: string
          kind?: string
          language?: string
          lapses?: number
          last_reviewed_on?: string | null
          learned_on?: string
          reviews?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "language_progress_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "language_progress_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      language_study: {
        Row: {
          active: boolean
          characters_per_day: number
          characters_task_id: string | null
          household_id: string
          language: string
          review_task_id: string | null
          start_level: number
          updated_at: string
          user_id: string
          words_per_day: number
          words_task_id: string | null
        }
        Insert: {
          active?: boolean
          characters_per_day?: number
          characters_task_id?: string | null
          household_id: string
          language: string
          review_task_id?: string | null
          start_level?: number
          updated_at?: string
          user_id?: string
          words_per_day?: number
          words_task_id?: string | null
        }
        Update: {
          active?: boolean
          characters_per_day?: number
          characters_task_id?: string | null
          household_id?: string
          language?: string
          review_task_id?: string | null
          start_level?: number
          updated_at?: string
          user_id?: string
          words_per_day?: number
          words_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "language_study_characters_task_id_household_id_fkey"
            columns: ["characters_task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "language_study_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "language_study_household_id_user_id_fkey"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "language_study_review_task_id_household_id_fkey"
            columns: ["review_task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "language_study_words_task_id_household_id_fkey"
            columns: ["words_task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string
          created_at: string
          display_name: string
          id: string
          tracks_periods: boolean
          updated_at: string
        }
        Insert: {
          avatar_color?: string
          created_at?: string
          display_name: string
          id: string
          tracks_periods?: boolean
          updated_at?: string
        }
        Update: {
          avatar_color?: string
          created_at?: string
          display_name?: string
          id?: string
          tracks_periods?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      savings_goals: {
        Row: {
          account_id: string | null
          archived_at: string | null
          created_at: string
          created_by: string
          currency: string
          household_id: string
          id: string
          manual_saved_minor: number
          name: string
          owner_id: string | null
          ownership: string
          pot_id: string | null
          reached_at: string | null
          sort_order: number
          target_date: string | null
          target_minor: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          household_id: string
          id?: string
          manual_saved_minor?: number
          name: string
          owner_id?: string | null
          ownership?: string
          pot_id?: string | null
          reached_at?: string | null
          sort_order?: number
          target_date?: string | null
          target_minor: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          household_id?: string
          id?: string
          manual_saved_minor?: number
          name?: string
          owner_id?: string | null
          ownership?: string
          pot_id?: string | null
          reached_at?: string | null
          sort_order?: number
          target_date?: string | null
          target_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "savings_goals_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "savings_goals_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "savings_goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "savings_goals_household_id_owner_id_fkey"
            columns: ["household_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "savings_goals_pot_id_household_id_fkey"
            columns: ["pot_id", "household_id"]
            isOneToOne: false
            referencedRelation: "savings_pots"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      savings_pots: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string
          household_id: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string
          household_id: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string
          household_id?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "savings_pots_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_account_balances"
            referencedColumns: ["account_id", "household_id"]
          },
          {
            foreignKeyName: "savings_pots_account_id_household_id_fkey"
            columns: ["account_id", "household_id"]
            isOneToOne: false
            referencedRelation: "financial_accounts"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "savings_pots_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      task_categories: {
        Row: {
          color: string
          created_at: string
          household_id: string
          id: string
          name: string
          owner_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          household_id: string
          id?: string
          name: string
          owner_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_categories_household_id_owner_id_fkey"
            columns: ["household_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          household_id: string
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          household_id: string
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          household_id?: string
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_household_id_author_id_fkey"
            columns: ["household_id", "author_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "task_comments_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_household_id_fkey"
            columns: ["task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      task_completion_events: {
        Row: {
          also_completed_by: string | null
          assignee_id: string | null
          category_id: string | null
          category_name: string | null
          completed_by: string | null
          due_date: string | null
          event_type: string
          household_id: string
          id: string
          is_recurring: boolean
          list_id: string | null
          note: string | null
          occurred_at: string
          occurrence_created_at: string | null
          occurrence_id: string
          occurrence_sequence: number | null
          recorded_at: string
          recorded_by: string | null
          task_id: string
          task_title: string
        }
        Insert: {
          also_completed_by?: string | null
          assignee_id?: string | null
          category_id?: string | null
          category_name?: string | null
          completed_by?: string | null
          due_date?: string | null
          event_type: string
          household_id: string
          id?: string
          is_recurring: boolean
          list_id?: string | null
          note?: string | null
          occurred_at: string
          occurrence_created_at?: string | null
          occurrence_id: string
          occurrence_sequence?: number | null
          recorded_at?: string
          recorded_by?: string | null
          task_id: string
          task_title: string
        }
        Update: {
          also_completed_by?: string | null
          assignee_id?: string | null
          category_id?: string | null
          category_name?: string | null
          completed_by?: string | null
          due_date?: string | null
          event_type?: string
          household_id?: string
          id?: string
          is_recurring?: boolean
          list_id?: string | null
          note?: string | null
          occurred_at?: string
          occurrence_created_at?: string | null
          occurrence_id?: string
          occurrence_sequence?: number | null
          recorded_at?: string
          recorded_by?: string | null
          task_id?: string
          task_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_completion_events_also_completed_by_fkey"
            columns: ["also_completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completion_events_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completion_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_completion_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_lists: {
        Row: {
          created_at: string
          household_id: string
          id: string
          kind: string
          name: string
          owner_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          kind: string
          name: string
          owner_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          kind?: string
          name?: string
          owner_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_lists_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_lists_household_id_owner_id_fkey"
            columns: ["household_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      task_occurrences: {
        Row: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        Insert: {
          also_completed_by?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          delay_count?: number
          due_date?: string | null
          due_time?: string | null
          generated_from?: string | null
          household_id: string
          id?: string
          sequence?: number
          status?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          also_completed_by?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          delay_count?: number
          due_date?: string | null
          due_time?: string | null
          generated_from?: string | null
          household_id?: string
          id?: string
          sequence?: number
          status?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_occurrences_generated_from_fkey"
            columns: ["generated_from"]
            isOneToOne: false
            referencedRelation: "task_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_household_id_also_completed_by_fkey"
            columns: ["household_id", "also_completed_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "task_occurrences_household_id_assignee_id_fkey"
            columns: ["household_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "task_occurrences_household_id_completed_by_fkey"
            columns: ["household_id", "completed_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "task_occurrences_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_occurrences_task_id_household_id_fkey"
            columns: ["task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      task_rooms: {
        Row: {
          created_at: string
          household_id: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_rooms_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      task_subtasks: {
        Row: {
          created_at: string
          done_at: string | null
          done_by: string | null
          due_date: string | null
          household_id: string
          id: string
          is_done: boolean
          sort_order: number
          task_id: string
          title: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          household_id: string
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id: string
          title: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          household_id?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_subtasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_subtasks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_subtasks_task_id_household_id_fkey"
            columns: ["task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          category_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          deadline: string | null
          description: string | null
          due_date: string | null
          due_time: string | null
          household_id: string
          id: string
          importance_votes: number
          last_done_on: string | null
          list_id: string
          needs_both: boolean
          priority: string
          recurrence: Json | null
          room_id: string | null
          status: string
          subtasks_collapsed: boolean
          title: string
          updated_at: string
          waiting_on_task_id: string | null
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          category_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          deadline?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          household_id: string
          id?: string
          importance_votes?: number
          last_done_on?: string | null
          list_id: string
          needs_both?: boolean
          priority?: string
          recurrence?: Json | null
          room_id?: string | null
          status?: string
          subtasks_collapsed?: boolean
          title: string
          updated_at?: string
          waiting_on_task_id?: string | null
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          category_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          deadline?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          household_id?: string
          id?: string
          importance_votes?: number
          last_done_on?: string | null
          list_id?: string
          needs_both?: boolean
          priority?: string
          recurrence?: Json | null
          room_id?: string | null
          status?: string
          subtasks_collapsed?: boolean
          title?: string
          updated_at?: string
          waiting_on_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_category_id_household_id_fkey"
            columns: ["category_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "tasks_household_id_assignee_id_fkey"
            columns: ["household_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_household_id_completed_by_fkey"
            columns: ["household_id", "completed_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_household_id_created_by_fkey"
            columns: ["household_id", "created_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_list_id_household_id_fkey"
            columns: ["list_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "tasks_room_id_household_id_fkey"
            columns: ["room_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_rooms"
            referencedColumns: ["id", "household_id"]
          },
          {
            foreignKeyName: "tasks_waiting_on_fkey"
            columns: ["waiting_on_task_id", "household_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          default_task_list_id: string | null
          settings: Json
          theme: string
          updated_at: string
          user_id: string
          week_starts_on: number
        }
        Insert: {
          default_task_list_id?: string | null
          settings?: Json
          theme?: string
          updated_at?: string
          user_id: string
          week_starts_on?: number
        }
        Update: {
          default_task_list_id?: string | null
          settings?: Json
          theme?: string
          updated_at?: string
          user_id?: string
          week_starts_on?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_default_task_list_fk"
            columns: ["default_task_list_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_budget_items: {
        Row: {
          budget_minor: number
          category: string
          created_at: string
          created_by: string
          due_date: string | null
          household_id: string
          id: string
          name: string
          notes: string | null
          paid_minor: number
          sort_order: number
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          budget_minor?: number
          category: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          household_id: string
          id?: string
          name: string
          notes?: string | null
          paid_minor?: number
          sort_order?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          budget_minor?: number
          category?: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          household_id?: string
          id?: string
          name?: string
          notes?: string | null
          paid_minor?: number
          sort_order?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_budget_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_budget_items_supplier_id_household_id_fkey"
            columns: ["supplier_id", "household_id"]
            isOneToOne: false
            referencedRelation: "wedding_suppliers"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      wedding_guests: {
        Row: {
          created_at: string
          created_by: string
          dietary: string | null
          household_id: string
          id: string
          invite: string
          name: string
          notes: string | null
          party: string | null
          plus_one: boolean
          rsvp: string
          table_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          dietary?: string | null
          household_id: string
          id?: string
          invite?: string
          name: string
          notes?: string | null
          party?: string | null
          plus_one?: boolean
          rsvp?: string
          table_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dietary?: string | null
          household_id?: string
          id?: string
          invite?: string
          name?: string
          notes?: string | null
          party?: string | null
          plus_one?: boolean
          rsvp?: string
          table_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_guests_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_settings: {
        Row: {
          household_id: string
          pot_goal_id: string | null
          task_category_id: string | null
          updated_at: string
          wedding_date: string | null
        }
        Insert: {
          household_id: string
          pot_goal_id?: string | null
          task_category_id?: string | null
          updated_at?: string
          wedding_date?: string | null
        }
        Update: {
          household_id?: string
          pot_goal_id?: string | null
          task_category_id?: string | null
          updated_at?: string
          wedding_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wedding_settings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_settings_pot_goal_id_fkey"
            columns: ["pot_goal_id"]
            isOneToOne: false
            referencedRelation: "savings_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_settings_task_category_id_household_id_fkey"
            columns: ["task_category_id", "household_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      wedding_suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          created_by: string
          email: string | null
          household_id: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          role: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          household_id: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          role: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          household_id?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wedding_suppliers_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      financial_account_balances: {
        Row: {
          account_id: string | null
          balance_minor: number | null
          currency: string | null
          household_id: string | null
          last_recorded_on: string | null
        }
        Insert: {
          account_id?: string | null
          balance_minor?: never
          currency?: string | null
          household_id?: string | null
          last_recorded_on?: never
        }
        Update: {
          account_id?: string | null
          balance_minor?: never
          currency?: string | null
          household_id?: string | null
          last_recorded_on?: never
        }
        Relationships: [
          {
            foreignKeyName: "financial_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _task_lock_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _task_record_event: {
        Args: {
          p_completed_by: string
          p_event_type: string
          p_note: string
          p_occ: Database["public"]["Tables"]["task_occurrences"]["Row"]
          p_occurred_at: string
          p_task: Database["public"]["Tables"]["tasks"]["Row"]
        }
        Returns: undefined
      }
      account_balance_on: {
        Args: { p_account_id: string; p_date: string }
        Returns: number
      }
      apply_sheet_balances: {
        Args: { p_balances: Json; p_error?: string; p_source_id: string }
        Returns: Json
      }
      bootstrap_household: {
        Args: { p_members: Json; p_name: string }
        Returns: string
      }
      complete_task_occurrence: {
        Args: {
          p_also_completed_by?: string
          p_completed_at?: string
          p_completed_by?: string
          p_note?: string
          p_occurrence_id: string
        }
        Returns: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_transfer: {
        Args: {
          p_amount_minor: number
          p_description: string
          p_from_account_id: string
          p_notes?: string
          p_occurred_on: string
          p_to_account_id: string
          p_to_amount_minor?: number
        }
        Returns: string
      }
      current_household_id: { Args: never; Returns: string }
      household_today: { Args: { p_household_id: string }; Returns: string }
      is_household_member: {
        Args: { p_household_id: string }
        Returns: boolean
      }
      is_valid_recurrence: { Args: { p_rule: Json }; Returns: boolean }
      log_feed_event: {
        Args: {
          p_actor_id: string
          p_entity_id: string
          p_entity_type: string
          p_event_type: string
          p_household_id: string
          p_metadata?: Json
          p_summary: string
        }
        Returns: undefined
      }
      recurrence_next_date: {
        Args: { p_after: string; p_anchor: string; p_rule: Json }
        Returns: string
      }
      refresh_savings_goals: {
        Args: { p_account_id?: string; p_household_id: string }
        Returns: undefined
      }
      reopen_task_occurrence: {
        Args: { p_note?: string; p_occurrence_id: string }
        Returns: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_sheet_links: {
        Args: { p_household_id: string; p_links: Json }
        Returns: undefined
      }
      set_task_occurrence_completed_by: {
        Args: {
          p_also_completed_by?: string
          p_completed_by: string
          p_occurrence_id: string
        }
        Returns: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shares_household_with: { Args: { p_user_id: string }; Returns: boolean }
      skip_task_occurrence: {
        Args: { p_note?: string; p_occurrence_id: string }
        Returns: {
          also_completed_by: string | null
          assignee_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          delay_count: number
          due_date: string | null
          due_time: string | null
          generated_from: string | null
          household_id: string
          id: string
          sequence: number
          status: string
          task_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "task_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_wedding_pot_target: {
        Args: { p_household_id: string }
        Returns: undefined
      }
      task_category_owner: { Args: { p_category_id: string }; Returns: string }
      task_generate_next_occurrence: {
        Args: { p_after: string; p_generated_from: string; p_task_id: string }
        Returns: string
      }
      task_last_done_on: { Args: { p_task_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

