import { createFileRoute } from "@tanstack/react-router";
import { Terminal } from "@/components/terminal";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Terminal />;
}
