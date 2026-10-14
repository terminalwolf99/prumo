// Test phase only. The accounts (fake @teste.invalid people) are public; their
// password is not: on localhost it comes from the gitignored dev.js, on the live
// site the tester types it once. Set TEST_MODE = false and run
// supabase/dev/reset-demo.sql before real students use Prumo.
export const TEST_MODE = true

export const DEMO_ACCOUNTS = [
  { email: 'estudante1@teste.invalid', label: 'Ana · 1º ano' },
  { email: 'estudante2@teste.invalid', label: 'Bruno · 2º ano' },
  { email: 'estudante3@teste.invalid', label: 'Carla · 3º ano' },
  { email: 'estudante4@teste.invalid', label: 'Davi · 2º ano' },
  { email: 'prof.demo@teste.invalid', label: 'Professora' },
  { email: 'admin.demo@teste.invalid', label: 'Administração' },
]
