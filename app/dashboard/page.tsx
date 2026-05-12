import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <h1 className="text-4xl font-bold">Welcome to Hearth</h1>
        <p className="mt-4 text-gray-600">
          Signed in as <span className="font-medium">{user?.email}</span>
        </p>
        <form action="/auth/signout" method="post" className="mt-8">
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
