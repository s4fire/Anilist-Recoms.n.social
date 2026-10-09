import { handleThreadWrite } from "../_shared/thread_write.ts";

Deno.serve((request: Request) => handleThreadWrite(request, "post"));
