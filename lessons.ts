export async function greet(name: string, title: string): Promise<string> {
  
    if (title) {
        return `Hello, ${title} ${name}!`;
    }
    else {
        return `Hello, ${name}!`;
    }

  }
