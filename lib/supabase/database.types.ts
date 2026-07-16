export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      checkpoint_arrivals: {
        Row: {
          arrived_at: string
          checkpoint: string
          confirmed_by: string | null
          id: string
          team_id: string
        }
        Insert: {
          arrived_at?: string
          checkpoint: string
          confirmed_by?: string | null
          id?: string
          team_id: string
        }
        Update: {
          arrived_at?: string
          checkpoint?: string
          confirmed_by?: string | null
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkpoint_arrivals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      collected_cards: {
        Row: {
          awarded_at: string
          awarded_by: string
          card_code: string
          id: string
          team_id: string
        }
        Insert: {
          awarded_at?: string
          awarded_by: string
          card_code: string
          id?: string
          team_id: string
        }
        Update: {
          awarded_at?: string
          awarded_by?: string
          card_code?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collected_cards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          auth_id: string
          created_at: string
          id: string
          is_active_controller: boolean
          last_seen_at: string
          team_id: string
        }
        Insert: {
          auth_id: string
          created_at?: string
          id?: string
          is_active_controller?: boolean
          last_seen_at?: string
          team_id: string
        }
        Update: {
          auth_id?: string
          created_at?: string
          id?: string
          is_active_controller?: boolean
          last_seen_at?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          name: string
          starts_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          starts_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          starts_at?: string | null
          status?: string
        }
        Relationships: []
      }
      finalists: {
        Row: {
          arrival_order: number
          event_id: string
          hearts_at_qualification: number
          id: string
          qualified_at: string
          slot: number
          team_id: string
        }
        Insert: {
          arrival_order: number
          event_id: string
          hearts_at_qualification: number
          id?: string
          qualified_at?: string
          slot: number
          team_id: string
        }
        Update: {
          arrival_order?: number
          event_id?: string
          hearts_at_qualification?: number
          id?: string
          qualified_at?: string
          slot?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finalists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finalists_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      heart_transactions: {
        Row: {
          created_at: string
          created_by: string
          delta: number
          id: string
          reason: string
          related_id: string | null
          reversal_of: string | null
          source_round: string
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          delta: number
          id?: string
          reason: string
          related_id?: string | null
          reversal_of?: string | null
          source_round: string
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          delta?: number
          id?: string
          reason?: string
          related_id?: string | null
          reversal_of?: string | null
          source_round?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "heart_transactions_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "heart_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heart_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_actions: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          target_team_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_team_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manager_actions_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          pin_hash: string | null
          role: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          pin_hash?: string | null
          role: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          pin_hash?: string | null
          role?: string
        }
        Relationships: []
      }
      matchups: {
        Row: {
          created_at: string
          deadline_at: string | null
          event_id: string
          id: string
          resolved_at: string | null
          starts_at: string | null
          status: string
          team_a_id: string
          team_a_ready: boolean
          team_b_id: string
          team_b_ready: boolean
        }
        Insert: {
          created_at?: string
          deadline_at?: string | null
          event_id: string
          id?: string
          resolved_at?: string | null
          starts_at?: string | null
          status?: string
          team_a_id: string
          team_a_ready?: boolean
          team_b_id: string
          team_b_ready?: boolean
        }
        Update: {
          created_at?: string
          deadline_at?: string | null
          event_id?: string
          id?: string
          resolved_at?: string | null
          starts_at?: string | null
          status?: string
          team_a_id?: string
          team_a_ready?: boolean
          team_b_id?: string
          team_b_ready?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "matchups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pair_invites: {
        Row: {
          created_at: string
          event_id: string
          from_player_id: string
          id: string
          resolved_at: string | null
          status: string
          to_player_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          from_player_id: string
          id?: string
          resolved_at?: string | null
          status?: string
          to_player_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          from_player_id?: string
          id?: string
          resolved_at?: string | null
          status?: string
          to_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pair_invites_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pair_invites_from_player_id_fkey"
            columns: ["from_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pair_invites_to_player_id_fkey"
            columns: ["to_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_claims: {
        Row: {
          auth_id: string
          claimed_at: string
          id: string
          pin: string | null
          player_id: string
          released_at: string | null
        }
        Insert: {
          auth_id: string
          claimed_at?: string
          id?: string
          pin?: string | null
          player_id: string
          released_at?: string | null
        }
        Update: {
          auth_id?: string
          claimed_at?: string
          id?: string
          pin?: string | null
          player_id?: string
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_claims_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          claim_status: string
          claimed_by_auth_id: string | null
          created_at: string
          display_name: string
          event_id: string
          id: string
          selfie_path: string | null
        }
        Insert: {
          claim_status?: string
          claimed_by_auth_id?: string | null
          created_at?: string
          display_name: string
          event_id: string
          id?: string
          selfie_path?: string | null
        }
        Update: {
          claim_status?: string
          claimed_by_auth_id?: string | null
          created_at?: string
          display_name?: string
          event_id?: string
          id?: string
          selfie_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      share_steal_submissions: {
        Row: {
          choice: string
          id: string
          is_timeout_default: boolean
          locked_at: string
          matchup_id: string
          team_id: string
        }
        Insert: {
          choice: string
          id?: string
          is_timeout_default?: boolean
          locked_at?: string
          matchup_id: string
          team_id: string
        }
        Update: {
          choice?: string
          id?: string
          is_timeout_default?: boolean
          locked_at?: string
          matchup_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_steal_submissions_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_steal_submissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string
          player_id: string
          team_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          player_id: string
          team_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          player_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          active_controller_auth_id: string | null
          active_controller_device_id: string | null
          created_at: string
          event_id: string
          hearts_cached: number
          id: string
          name: string
          pre_elimination_status: string | null
          recovery_pin_hash: string
          status: string
          updated_at: string
        }
        Insert: {
          active_controller_auth_id?: string | null
          active_controller_device_id?: string | null
          created_at?: string
          event_id: string
          hearts_cached?: number
          id?: string
          name: string
          pre_elimination_status?: string | null
          recovery_pin_hash: string
          status?: string
          updated_at?: string
        }
        Update: {
          active_controller_auth_id?: string | null
          active_controller_device_id?: string | null
          created_at?: string
          event_id?: string
          hearts_cached?: number
          id?: string
          name?: string
          pre_elimination_status?: string | null
          recovery_pin_hash?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_active_controller_device_fk"
            columns: ["active_controller_device_id"]
            isOneToOne: false
            referencedRelation: "device_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      winner_results: {
        Row: {
          event_id: string
          id: string
          reversed: boolean
          reversed_at: string | null
          team_id: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          event_id: string
          id?: string
          reversed?: boolean
          reversed_at?: string | null
          team_id: string
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          event_id?: string
          id?: string
          reversed?: boolean
          reversed_at?: string | null
          team_id?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "winner_results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "winner_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
