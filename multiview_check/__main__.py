import argparse
import sys
from .checker import check_dataset
from .report import write_report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Local multiview dataset checks. Never modifies source images.')
    parser.add_argument('manifest',help='Path to the v1 JSON dataset manifest')
    parser.add_argument('--output',default='multiview-report',help='Report output directory')
    parser.add_argument('--strict',action='store_true',help='Also return exit 1 when warnings exist')
    args = parser.parse_args(argv)
    report = check_dataset(args.manifest)
    try:
        write_report(report,args.output)
    except OSError as error:
        print(f'Cannot write report: {error}',file=sys.stderr)
        return 2
    s=report['summary']
    print(f"Checked {s['frames']} frame(s): {s['errors']} errors, {s['warnings']} warnings. Report: {args.output}")
    return int(s['errors']>0 or (args.strict and s['warnings']>0))


if __name__=='__main__':
    sys.exit(main())
