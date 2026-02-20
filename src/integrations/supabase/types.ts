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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          completed_count: number
          id: string
          is_enabled: boolean
          last_completed_score: number | null
          status: string
          student_id: string
          task_no: number
          verb_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          completed_count?: number
          id?: string
          is_enabled?: boolean
          last_completed_score?: number | null
          status?: string
          student_id: string
          task_no: number
          verb_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          completed_count?: number
          id?: string
          is_enabled?: boolean
          last_completed_score?: number | null
          status?: string
          student_id?: string
          task_no?: number
          verb_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_student_id_profiles_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_verb_id_fkey"
            columns: ["verb_id"]
            isOneToOne: false
            referencedRelation: "verbs"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_balance: {
        Row: {
          balance_usd: number
          id: string
          updated_at: string
        }
        Insert: {
          balance_usd?: number
          id?: string
          updated_at?: string
        }
        Update: {
          balance_usd?: number
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_events: {
        Row: {
          amount_usd: number
          created_at: string
          id: string
          note: string | null
          type: string
        }
        Insert: {
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          type?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      daily_usage: {
        Row: {
          date: string
          id: string
          limit_seconds: number
          student_id: string
          used_seconds: number
        }
        Insert: {
          date?: string
          id?: string
          limit_seconds?: number
          student_id: string
          used_seconds?: number
        }
        Update: {
          date?: string
          id?: string
          limit_seconds?: number
          student_id?: string
          used_seconds?: number
        }
        Relationships: []
      }
      learning_history: {
        Row: {
          ai_explanation: string | null
          example_sentences: string[] | null
          expression: string
          id: string
          learned_at: string
          session_date: string
          student_id: string
        }
        Insert: {
          ai_explanation?: string | null
          example_sentences?: string[] | null
          expression: string
          id?: string
          learned_at?: string
          session_date?: string
          student_id: string
        }
        Update: {
          ai_explanation?: string | null
          example_sentences?: string[] | null
          expression?: string
          id?: string
          learned_at?: string
          session_date?: string
          student_id?: string
        }
        Relationships: []
      }
      practice_logs: {
        Row: {
          ai_feedback: string | null
          assignment_id: string | null
          attempt_no: number
          audio_seconds: number
          created_at: string
          id: string
          result: string
          score: number | null
          situation_index: number
          student_id: string
          student_transcript: string | null
        }
        Insert: {
          ai_feedback?: string | null
          assignment_id?: string | null
          attempt_no?: number
          audio_seconds?: number
          created_at?: string
          id?: string
          result?: string
          score?: number | null
          situation_index?: number
          student_id: string
          student_transcript?: string | null
        }
        Update: {
          ai_feedback?: string | null
          assignment_id?: string | null
          attempt_no?: number
          audio_seconds?: number
          created_at?: string
          id?: string
          result?: string
          score?: number | null
          situation_index?: number
          student_id?: string
          student_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_logs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_id: string | null
          created_at: string
          daily_quota_minutes: number
          difficulty_level: Database["public"]["Enums"]["difficulty_level"]
          display_name: string | null
          group_name: string
          id: string
          korean_hint_mode: boolean
          role: Database["public"]["Enums"]["app_role"]
          speech_speed: Database["public"]["Enums"]["speech_speed"]
          student_id: string | null
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          daily_quota_minutes?: number
          difficulty_level?: Database["public"]["Enums"]["difficulty_level"]
          display_name?: string | null
          group_name?: string
          id: string
          korean_hint_mode?: boolean
          role: Database["public"]["Enums"]["app_role"]
          speech_speed?: Database["public"]["Enums"]["speech_speed"]
          student_id?: string | null
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          daily_quota_minutes?: number
          difficulty_level?: Database["public"]["Enums"]["difficulty_level"]
          display_name?: string | null
          group_name?: string
          id?: string
          korean_hint_mode?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          speech_speed?: Database["public"]["Enums"]["speech_speed"]
          student_id?: string | null
        }
        Relationships: []
      }
      speaking_sessions: {
        Row: {
          assignment_id: string | null
          created_at: string
          duration_seconds: number
          id: string
          session_date: string
          student_id: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          session_date?: string
          student_id: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          session_date?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaking_sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verbs: {
        Row: {
          anchor_long_1: string | null
          anchor_long_2: string | null
          anchor_long_3: string | null
          anchor_short_1: string | null
          anchor_short_2: string | null
          anchor_short_3: string | null
          base_verb: string
          created_at: string
          created_by: string | null
          display_no: number | null
          id: string
          is_active: boolean
          meaning_en: string | null
          situation_seed_1: string | null
          situation_seed_2: string | null
          situation_seed_3: string | null
          situation_seed_4: string | null
          verb_key: string
          verb_no: number
        }
        Insert: {
          anchor_long_1?: string | null
          anchor_long_2?: string | null
          anchor_long_3?: string | null
          anchor_short_1?: string | null
          anchor_short_2?: string | null
          anchor_short_3?: string | null
          base_verb: string
          created_at?: string
          created_by?: string | null
          display_no?: number | null
          id?: string
          is_active?: boolean
          meaning_en?: string | null
          situation_seed_1?: string | null
          situation_seed_2?: string | null
          situation_seed_3?: string | null
          situation_seed_4?: string | null
          verb_key: string
          verb_no: number
        }
        Update: {
          anchor_long_1?: string | null
          anchor_long_2?: string | null
          anchor_long_3?: string | null
          anchor_short_1?: string | null
          anchor_short_2?: string | null
          anchor_short_3?: string | null
          base_verb?: string
          created_at?: string
          created_by?: string | null
          display_no?: number | null
          id?: string
          is_active?: boolean
          meaning_en?: string | null
          situation_seed_1?: string | null
          situation_seed_2?: string | null
          situation_seed_3?: string | null
          situation_seed_4?: string | null
          verb_key?: string
          verb_no?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_daily_usage: {
        Args: { _date?: string; _student_id: string }
        Returns: number
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "student"
      difficulty_level: "low" | "medium" | "high"
      speech_speed: "slow" | "medium" | "fast"
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
    Enums: {
      app_role: ["admin", "student"],
      difficulty_level: ["low", "medium", "high"],
      speech_speed: ["slow", "medium", "fast"],
    },
  },
} as const
