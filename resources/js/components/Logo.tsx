import { cn } from '@/lib/utils';

interface LogoProps {
    className?: string;
    size?: number;
}

export function Logo({ className, size = 32 }: LogoProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn('shrink-0', className)}
        >
            {/* Bucket body */}
            <path
                d="M10 18L13 40C13.2 41.7 14.6 43 16.3 43H31.7C33.4 43 34.8 41.7 35 40L38 18"
                className="fill-primary/10 stroke-primary"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* Bucket rim */}
            <rect
                x="7"
                y="14"
                width="34"
                height="5"
                rx="2.5"
                className="fill-primary"
            />
            {/* Handle */}
            <path
                d="M17 14V10C17 7.23858 19.2386 5 22 5H26C28.7614 5 31 7.23858 31 10V14"
                className="stroke-primary"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
            />
            {/* Code brackets </> */}
            <path
                d="M19 27L16 30.5L19 34"
                className="stroke-primary"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            <path
                d="M29 27L32 30.5L29 34"
                className="stroke-primary"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            <path
                d="M26 25L22 36"
                className="stroke-primary"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
            />
        </svg>
    );
}
